import type { WebSocket } from 'ws';
import { LspBridge, RunningLspInfo } from './lsp-bridge.js';
import { juliaProject } from './julia-project.js';

const bridge = new LspBridge();

export const juliaLsp = {
  handleWebSocket(ws: WebSocket, sessionId: string, projectPath: string): void {
    // LanguageServer.jl lives in a shared env that's installed lazily on first
    // use (slow). Until it's ready we can't spawn the server, so tell the client
    // to wait and close — its 3s reconnect loop retries until the install lands.
    juliaProject.isLsEnvReady(); // kick off the one-time background install
    if (!juliaProject.isLsEnvReady()) {
      try {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'window/logMessage',
          params: { type: 3, message: juliaProject.lsEnvStatusMessage() },
        }));
      } catch { /* socket may already be gone */ }
      try { ws.close(); } catch { /* */ }
      return;
    }

    bridge.handleWebSocket(ws, sessionId, {
      // LanguageServer.jl speaks LSP over stdio. It runs in the shared LS env
      // (--project) and analyses the session project dir (passed as ARGS[1]).
      command: 'julia',
      args: juliaProject.lsServerArgs(projectPath),
      cwd: projectPath,
      logPrefix: `julia-lsp:${sessionId.slice(0, 8)}`,
    });
  },

  isRunning(sessionId: string): boolean {
    return bridge.isRunning(sessionId);
  },

  listRunning(): RunningLspInfo[] {
    return bridge.listRunning();
  },

  stopLsp(sessionId: string): void {
    bridge.stop(sessionId);
  },

  stopAll(): void {
    bridge.stopAll();
  },

  forceStopAll(): void {
    bridge.forceStopAll();
  },
};
