import { spawn, ChildProcess } from 'child_process';
import type { WebSocket } from 'ws';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface LeanProcess {
  process: ChildProcess;
  projectPath: string;
  lastActivity: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  clients: Set<WebSocket>;
  stdoutBuffer: string;
}

const processes = new Map<string, LeanProcess>();

function parseContentLength(data: string): { length: number; headerEnd: number } | null {
  const match = data.match(/Content-Length:\s*(\d+)\r\n\r\n/);
  if (!match) return null;
  return {
    length: parseInt(match[1], 10),
    headerEnd: match.index! + match[0].length,
  };
}

function sendToLsp(lp: LeanProcess, message: string): void {
  const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
  lp.process.stdin?.write(header + message);
}

function broadcastToClients(lp: LeanProcess, message: string): void {
  for (const ws of lp.clients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(message);
    }
  }
}

function processStdout(sessionId: string, lp: LeanProcess): void {
  while (true) {
    const parsed = parseContentLength(lp.stdoutBuffer);
    if (!parsed) break;

    const messageStart = parsed.headerEnd;
    const messageEnd = messageStart + parsed.length;

    // Check if we have the full message in the buffer
    if (Buffer.byteLength(lp.stdoutBuffer.slice(messageStart)) < parsed.length) break;

    const message = lp.stdoutBuffer.slice(messageStart, messageStart + parsed.length);
    // Use byte length for slicing to handle multi-byte chars correctly
    // Since we're working with strings, recalculate based on character positions
    lp.stdoutBuffer = lp.stdoutBuffer.slice(messageEnd);

    broadcastToClients(lp, message);
  }
}

function startIdleTimer(sessionId: string, lp: LeanProcess): void {
  if (lp.idleTimer) clearTimeout(lp.idleTimer);
  lp.idleTimer = setTimeout(() => {
    if (lp.clients.size === 0) {
      leanLsp.stopLsp(sessionId);
    }
  }, IDLE_TIMEOUT_MS);
}

export const leanLsp = {
  startLsp(sessionId: string, projectPath: string): LeanProcess {
    const existing = processes.get(sessionId);
    if (existing) return existing;

    const proc = spawn('lean', ['--server'], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lp: LeanProcess = {
      process: proc,
      projectPath,
      lastActivity: Date.now(),
      idleTimer: null,
      clients: new Set(),
      stdoutBuffer: '',
    };

    proc.stdout?.on('data', (data: Buffer) => {
      lp.stdoutBuffer += data.toString();
      processStdout(sessionId, lp);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      // Lean server stderr - log but don't relay
      const msg = data.toString().trim();
      if (msg) console.error(`[lean-lsp:${sessionId.slice(0, 8)}] ${msg}`);
    });

    proc.on('close', (code) => {
      console.log(`[lean-lsp:${sessionId.slice(0, 8)}] process exited with code ${code}`);
      processes.delete(sessionId);
      // Notify all clients that the LSP process has stopped
      for (const ws of lp.clients) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'window/logMessage',
            params: { type: 3, message: 'Lean server process exited.' },
          }));
        }
      }
    });

    proc.on('error', (err) => {
      console.error(`[lean-lsp:${sessionId.slice(0, 8)}] spawn error: ${err.message}`);
      processes.delete(sessionId);
    });

    processes.set(sessionId, lp);
    return lp;
  },

  stopLsp(sessionId: string): void {
    const lp = processes.get(sessionId);
    if (!lp) return;

    if (lp.idleTimer) clearTimeout(lp.idleTimer);

    // Send LSP shutdown request
    try {
      const shutdownMsg = JSON.stringify({ jsonrpc: '2.0', id: 'shutdown', method: 'shutdown', params: null });
      sendToLsp(lp, shutdownMsg);

      // Send exit notification after a short delay
      setTimeout(() => {
        try {
          const exitMsg = JSON.stringify({ jsonrpc: '2.0', method: 'exit', params: null });
          sendToLsp(lp, exitMsg);
        } catch { /* process may already be dead */ }

        setTimeout(() => {
          try { lp.process.kill('SIGTERM'); } catch { /* */ }
          setTimeout(() => {
            try { lp.process.kill('SIGKILL'); } catch { /* */ }
          }, 2000);
        }, 1000);
      }, 500);
    } catch { /* process may already be dead */ }

    processes.delete(sessionId);
  },

  handleWebSocket(ws: WebSocket, sessionId: string, projectPath: string): void {
    const lp = this.startLsp(sessionId, projectPath);
    lp.clients.add(ws);
    lp.lastActivity = Date.now();

    // Cancel idle timer since we have an active client
    if (lp.idleTimer) {
      clearTimeout(lp.idleTimer);
      lp.idleTimer = null;
    }

    ws.on('message', (data) => {
      lp.lastActivity = Date.now();
      const message = data.toString();
      sendToLsp(lp, message);
    });

    ws.on('close', () => {
      lp.clients.delete(ws);
      if (lp.clients.size === 0) {
        startIdleTimer(sessionId, lp);
      }
    });

    ws.on('error', () => {
      lp.clients.delete(ws);
      if (lp.clients.size === 0) {
        startIdleTimer(sessionId, lp);
      }
    });
  },

  isRunning(sessionId: string): boolean {
    return processes.has(sessionId);
  },

  stopAll(): void {
    for (const [sessionId] of processes) {
      this.stopLsp(sessionId);
    }
  },
};
