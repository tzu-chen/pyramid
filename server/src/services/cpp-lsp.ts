import type { WebSocket } from 'ws';
import { LspBridge } from './lsp-bridge.js';

const bridge = new LspBridge();

export const cppLsp = {
  handleWebSocket(ws: WebSocket, sessionId: string, projectPath: string): void {
    bridge.handleWebSocket(ws, sessionId, {
      command: 'clangd',
      args: [
        '--background-index',         // index whole project in background
        '--clang-tidy',               // inline clang-tidy hints
        '--header-insertion=never',   // we manage includes manually
        '--completion-style=detailed',
        '--pch-storage=memory',       // faster, more RAM
        '--log=error',                // quiet stderr
      ],
      cwd: projectPath,
      logPrefix: `cpp-lsp:${sessionId.slice(0, 8)}`,
    });
  },

  isRunning(sessionId: string): boolean {
    return bridge.isRunning(sessionId);
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
