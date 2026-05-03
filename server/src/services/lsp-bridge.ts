import { spawn, ChildProcess } from 'child_process';
import type { WebSocket } from 'ws';

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export interface LspServerConfig {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  idleTimeoutMs?: number;
  logPrefix: string;     // e.g., 'lean-lsp:abc12345'
}

interface LspProcess {
  process: ChildProcess;
  config: LspServerConfig;
  lastActivity: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  clients: Set<WebSocket>;
  stdoutBuffer: Buffer;
  initialized: boolean;
  initializePending: boolean;
  initializeResult: unknown | null;
}

const HEADER_SEPARATOR = Buffer.from('\r\n\r\n');
const CONTENT_LENGTH_PREFIX = Buffer.from('Content-Length: ');

function sendToLsp(lp: LspProcess, message: string): void {
  const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
  lp.process.stdin?.write(header + message);
}

function broadcastToClients(lp: LspProcess, message: string): void {
  // Capture the initialize response for reconnection caching.
  // Note: don't set lp.initialized here — that must wait until the client's
  // 'initialized' notification is forwarded to the LSP server.
  if (!lp.initializeResult) {
    try {
      const parsed = JSON.parse(message);
      if (parsed.id !== undefined && parsed.result?.capabilities) {
        lp.initializeResult = parsed.result;
        lp.initializePending = false;
      }
    } catch { /* not JSON, ignore */ }
  }

  for (const ws of lp.clients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(message);
    }
  }
}

function processStdout(lp: LspProcess): void {
  while (true) {
    const prefixIdx = lp.stdoutBuffer.indexOf(CONTENT_LENGTH_PREFIX);
    if (prefixIdx === -1) break;

    const separatorIdx = lp.stdoutBuffer.indexOf(HEADER_SEPARATOR, prefixIdx);
    if (separatorIdx === -1) break;

    const lengthStr = lp.stdoutBuffer.slice(prefixIdx + CONTENT_LENGTH_PREFIX.length, separatorIdx).toString('ascii');
    const contentLength = parseInt(lengthStr, 10);
    if (isNaN(contentLength)) break;

    const messageStart = separatorIdx + HEADER_SEPARATOR.length;
    const messageEnd = messageStart + contentLength;

    if (lp.stdoutBuffer.length < messageEnd) break;

    const message = lp.stdoutBuffer.slice(messageStart, messageEnd).toString('utf-8');
    lp.stdoutBuffer = lp.stdoutBuffer.slice(messageEnd);

    broadcastToClients(lp, message);
  }
}

export class LspBridge {
  private processes = new Map<string, LspProcess>();

  start(sessionId: string, config: LspServerConfig): LspProcess {
    const existing = this.processes.get(sessionId);
    if (existing) return existing;

    const proc = spawn(config.command, config.args, {
      cwd: config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: config.env,
    });

    const lp: LspProcess = {
      process: proc,
      config,
      lastActivity: Date.now(),
      idleTimer: null,
      clients: new Set(),
      stdoutBuffer: Buffer.alloc(0),
      initialized: false,
      initializePending: false,
      initializeResult: null,
    };

    proc.stdout?.on('data', (data: Buffer) => {
      lp.stdoutBuffer = Buffer.concat([lp.stdoutBuffer, data]);
      processStdout(lp);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[${config.logPrefix}] ${msg}`);
    });

    proc.on('close', (code) => {
      console.log(`[${config.logPrefix}] process exited with code ${code}`);
      this.processes.delete(sessionId);
      for (const ws of lp.clients) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'window/logMessage',
            params: { type: 3, message: 'LSP server process exited.' },
          }));
        }
      }
    });

    proc.on('error', (err) => {
      console.error(`[${config.logPrefix}] spawn error: ${err.message}`);
      this.processes.delete(sessionId);
    });

    this.processes.set(sessionId, lp);
    return lp;
  }

  stop(sessionId: string): void {
    const lp = this.processes.get(sessionId);
    if (!lp) return;

    if (lp.idleTimer) clearTimeout(lp.idleTimer);

    try {
      const shutdownMsg = JSON.stringify({ jsonrpc: '2.0', id: 'shutdown', method: 'shutdown', params: null });
      sendToLsp(lp, shutdownMsg);

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

    this.processes.delete(sessionId);
  }

  handleWebSocket(ws: WebSocket, sessionId: string, config: LspServerConfig): void {
    const lp = this.start(sessionId, config);
    lp.clients.add(ws);
    lp.lastActivity = Date.now();

    if (lp.idleTimer) {
      clearTimeout(lp.idleTimer);
      lp.idleTimer = null;
    }

    ws.on('message', (data) => {
      lp.lastActivity = Date.now();
      const message = data.toString();

      try {
        const parsed = JSON.parse(message);

        if (parsed.method === 'initialize' && parsed.id !== undefined) {
          if (lp.initialized && lp.initializeResult) {
            // Reconnection: respond with cached result
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id,
              result: lp.initializeResult,
            }));
            return;
          }
          if (lp.initializePending) {
            // Another initialize is already in flight — don't forward a second
            // one to the LSP server (would crash with "Expected JSON-RPC notification")
            console.warn(`[${config.logPrefix}] Dropping duplicate initialize request (one already in flight)`);
            return;
          }
          lp.initializePending = true;
          sendToLsp(lp, message);
          return;
        }

        if (parsed.method === 'initialized') {
          if (!lp.initialized) {
            sendToLsp(lp, message);
            lp.initialized = true;
          }
          return;
        }
      } catch { /* not JSON, forward as-is */ }

      sendToLsp(lp, message);
    });

    ws.on('close', () => {
      lp.clients.delete(ws);
      if (lp.clients.size === 0) {
        this.startIdleTimer(sessionId, lp);
      }
    });

    ws.on('error', () => {
      lp.clients.delete(ws);
      if (lp.clients.size === 0) {
        this.startIdleTimer(sessionId, lp);
      }
    });
  }

  private startIdleTimer(sessionId: string, lp: LspProcess): void {
    if (lp.idleTimer) clearTimeout(lp.idleTimer);
    const timeout = lp.config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    lp.idleTimer = setTimeout(() => {
      if (lp.clients.size === 0) {
        this.stop(sessionId);
      }
    }, timeout);
  }

  isRunning(sessionId: string): boolean {
    return this.processes.has(sessionId);
  }

  stopAll(): void {
    for (const sessionId of Array.from(this.processes.keys())) {
      this.stop(sessionId);
    }
  }

  forceStopAll(): void {
    for (const [sessionId, lp] of this.processes) {
      if (lp.idleTimer) clearTimeout(lp.idleTimer);
      try { lp.process.kill('SIGKILL'); } catch { /* */ }
      this.processes.delete(sessionId);
    }
  }
}
