import type { WebSocket } from 'ws';
import { LspBridge, RunningLspInfo } from './lsp-bridge.js';

const bridge = new LspBridge();

export const leanLsp = {
  handleWebSocket(ws: WebSocket, sessionId: string, projectPath: string): void {
    bridge.handleWebSocket(ws, sessionId, {
      command: 'lean',
      args: ['--server'],
      cwd: projectPath,
      logPrefix: `lean-lsp:${sessionId.slice(0, 8)}`,
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
