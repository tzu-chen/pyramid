import type { WebSocket } from 'ws';
import { LspBridge, RunningLspInfo } from './lsp-bridge.js';

const bridge = new LspBridge();

export const rustLsp = {
  handleWebSocket(ws: WebSocket, sessionId: string, projectPath: string): void {
    bridge.handleWebSocket(ws, sessionId, {
      // rust-analyzer speaks LSP over stdio and takes essentially all of its
      // configuration through the `initialize` request's initializationOptions
      // (supplied by the client useRustLsp hook): check.command (check vs
      // clippy), cargo.features, checkOnSave, etc. So no extra CLI args here.
      command: 'rust-analyzer',
      args: [],
      cwd: projectPath,
      logPrefix: `rust-lsp:${sessionId.slice(0, 8)}`,
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
