import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import type { WebSocket } from 'ws';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const BRIDGE_SCRIPT = path.join(__dirname, 'jupyter-bridge.py');

interface KernelProcess {
  process: ChildProcess;
  cwd: string;
  lastActivity: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  clients: Set<WebSocket>;
  stdoutBuffer: string;
  ready: boolean;
}

const processes = new Map<string, KernelProcess>();

function broadcast(kp: KernelProcess, message: string): void {
  for (const ws of kp.clients) {
    if (ws.readyState === 1) ws.send(message);
  }
}

function sendToBridge(kp: KernelProcess, obj: unknown): void {
  kp.process.stdin?.write(JSON.stringify(obj) + '\n');
}

function processStdout(kp: KernelProcess): void {
  let idx: number;
  while ((idx = kp.stdoutBuffer.indexOf('\n')) !== -1) {
    const line = kp.stdoutBuffer.slice(0, idx).trim();
    kp.stdoutBuffer = kp.stdoutBuffer.slice(idx + 1);
    if (!line) continue;
    // Mark ready on first `ready` event, and broadcast regardless
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'ready') kp.ready = true;
    } catch { /* forward as-is */ }
    broadcast(kp, line);
  }
}

function startIdleTimer(sessionId: string, kp: KernelProcess): void {
  if (kp.idleTimer) clearTimeout(kp.idleTimer);
  kp.idleTimer = setTimeout(() => {
    if (kp.clients.size === 0) notebookKernel.stopKernel(sessionId);
  }, IDLE_TIMEOUT_MS);
}

export const notebookKernel = {
  startKernel(sessionId: string, cwd: string): KernelProcess {
    const existing = processes.get(sessionId);
    if (existing) return existing;

    const proc = spawn('python3', [BRIDGE_SCRIPT], {
      cwd,
      env: { ...process.env, PYRAMID_NOTEBOOK_CWD: cwd, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const kp: KernelProcess = {
      process: proc,
      cwd,
      lastActivity: Date.now(),
      idleTimer: null,
      clients: new Set(),
      stdoutBuffer: '',
      ready: false,
    };

    proc.stdout?.setEncoding('utf-8');
    proc.stdout?.on('data', (data: string) => {
      kp.stdoutBuffer += data;
      processStdout(kp);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[notebook:${sessionId.slice(0, 8)}] ${msg}`);
    });

    proc.on('close', (code) => {
      console.log(`[notebook:${sessionId.slice(0, 8)}] bridge exited code=${code}`);
      processes.delete(sessionId);
      broadcast(kp, JSON.stringify({ type: 'kernel_exit', code }));
    });

    proc.on('error', (err) => {
      console.error(`[notebook:${sessionId.slice(0, 8)}] spawn error: ${err.message}`);
      processes.delete(sessionId);
    });

    processes.set(sessionId, kp);
    return kp;
  },

  stopKernel(sessionId: string): void {
    const kp = processes.get(sessionId);
    if (!kp) return;
    if (kp.idleTimer) clearTimeout(kp.idleTimer);
    try { sendToBridge(kp, { cmd: 'shutdown' }); } catch { /* */ }
    setTimeout(() => {
      try { kp.process.kill('SIGTERM'); } catch { /* */ }
      setTimeout(() => {
        try { kp.process.kill('SIGKILL'); } catch { /* */ }
      }, 2000);
    }, 500);
    processes.delete(sessionId);
  },

  handleWebSocket(ws: WebSocket, sessionId: string, cwd: string): void {
    const kp = this.startKernel(sessionId, cwd);
    kp.clients.add(ws);
    kp.lastActivity = Date.now();
    if (kp.idleTimer) { clearTimeout(kp.idleTimer); kp.idleTimer = null; }

    // If kernel already ready, notify this late-joining client
    if (kp.ready) {
      try { ws.send(JSON.stringify({ type: 'ready' })); } catch { /* */ }
    }

    ws.on('message', (data) => {
      kp.lastActivity = Date.now();
      const raw = data.toString();
      try {
        const msg = JSON.parse(raw);
        if (msg && typeof msg.cmd === 'string') {
          sendToBridge(kp, msg);
        }
      } catch { /* ignore */ }
    });

    const onDisconnect = () => {
      kp.clients.delete(ws);
      if (kp.clients.size === 0) startIdleTimer(sessionId, kp);
    };
    ws.on('close', onDisconnect);
    ws.on('error', onDisconnect);
  },

  isRunning(sessionId: string): boolean {
    return processes.has(sessionId);
  },

  forceStopAll(): void {
    for (const [sessionId, kp] of processes) {
      if (kp.idleTimer) clearTimeout(kp.idleTimer);
      try { kp.process.kill('SIGKILL'); } catch { /* */ }
      processes.delete(sessionId);
    }
  },
};
