import { spawn, ChildProcess } from 'child_process';
import type { WebSocket } from 'ws';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface LeanProcess {
  process: ChildProcess;
  projectPath: string;
  lastActivity: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  clients: Set<WebSocket>;
  stdoutBuffer: Buffer;
  initialized: boolean;
  initializePending: boolean;
  initializeResult: unknown | null;
}

const processes = new Map<string, LeanProcess>();

const HEADER_SEPARATOR = Buffer.from('\r\n\r\n');
const CONTENT_LENGTH_PREFIX = Buffer.from('Content-Length: ');

function sendToLsp(lp: LeanProcess, message: string): void {
  const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
  lp.process.stdin?.write(header + message);
}

function broadcastToClients(lp: LeanProcess, message: string): void {
  // Capture the initialize response for reconnection caching
  // Note: don't set lp.initialized here — that must wait until the client's
  // 'initialized' notification is forwarded to Lean (see handleWebSocket)
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

function processStdout(sessionId: string, lp: LeanProcess): void {
  while (true) {
    // Find Content-Length header
    const prefixIdx = lp.stdoutBuffer.indexOf(CONTENT_LENGTH_PREFIX);
    if (prefixIdx === -1) break;

    const separatorIdx = lp.stdoutBuffer.indexOf(HEADER_SEPARATOR, prefixIdx);
    if (separatorIdx === -1) break;

    // Parse Content-Length value
    const lengthStr = lp.stdoutBuffer.slice(prefixIdx + CONTENT_LENGTH_PREFIX.length, separatorIdx).toString('ascii');
    const contentLength = parseInt(lengthStr, 10);
    if (isNaN(contentLength)) break;

    const messageStart = separatorIdx + HEADER_SEPARATOR.length;
    const messageEnd = messageStart + contentLength;

    // Check if we have the full message in the buffer
    if (lp.stdoutBuffer.length < messageEnd) break;

    const message = lp.stdoutBuffer.slice(messageStart, messageEnd).toString('utf-8');
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
      stdoutBuffer: Buffer.alloc(0),
      initialized: false,
      initializePending: false,
      initializeResult: null,
    };

    proc.stdout?.on('data', (data: Buffer) => {
      lp.stdoutBuffer = Buffer.concat([lp.stdoutBuffer, data]);
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

      try {
        const parsed = JSON.parse(message);

        // Handle initialize request
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
            // one to Lean (it would crash with "Expected JSON-RPC notification")
            console.warn(`[lean-lsp:${sessionId.slice(0, 8)}] Dropping duplicate initialize request (one already in flight)`);
            return;
          }
          // First connection: forward to Lean
          lp.initializePending = true;
          sendToLsp(lp, message);
          return;
        }

        // Handle initialized notification
        if (parsed.method === 'initialized') {
          if (!lp.initialized) {
            // First connection: forward to Lean, then mark as initialized
            sendToLsp(lp, message);
            lp.initialized = true;
          }
          // Reconnection: swallow (Lean already past init)
          return;
        }
      } catch { /* not JSON, forward as-is */ }

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

  forceStopAll(): void {
    for (const [sessionId, lp] of processes) {
      if (lp.idleTimer) clearTimeout(lp.idleTimer);
      try { lp.process.kill('SIGKILL'); } catch { /* */ }
      processes.delete(sessionId);
    }
  },
};
