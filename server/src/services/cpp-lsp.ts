import type { WebSocket } from 'ws';
import { LspBridge } from './lsp-bridge.js';

const bridge = new LspBridge();

export const cppLsp = {
  handleWebSocket(ws: WebSocket, sessionId: string, projectPath: string): void {
    bridge.handleWebSocket(ws, sessionId, {
      command: 'clangd',
      args: [
        // Index in the background but at OS background priority so it doesn't
        // contend with foreground work (compiles, the user's typing, etc.).
        '--background-index',
        '--background-index-priority=background',
        // clang-tidy is intentionally OFF by default — it ~doubles the cost of
        // every diagnostic round and is a major idle-CPU contributor. Force
        // off at the CLI level so older sessions whose .clangd still carries a
        // ClangTidy block don't re-enable it.
        '--clang-tidy=false',
        '--header-insertion=never',
        '--completion-style=detailed',
        '--pch-storage=memory',
        '--log=error',
        // Cap reference/result enumeration so a stray "find references" on a
        // common symbol can't peg the indexer.
        '--limit-references=1000',
        '--limit-results=100',
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
