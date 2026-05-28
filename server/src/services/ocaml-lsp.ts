import type { WebSocket } from 'ws';
import { LspBridge, RunningLspInfo } from './lsp-bridge.js';

const bridge = new LspBridge();

export const ocamlLsp = {
  handleWebSocket(ws: WebSocket, sessionId: string, projectPath: string): void {
    bridge.handleWebSocket(ws, sessionId, {
      command: 'ocamllsp',
      // ocaml-lsp-server uses stdio by default; no extra args needed for basic
      // operation. `--fallback-read-dot-merlin` lets it work with loose files
      // when there's no dune-project, which is the common single-file case.
      args: ['--fallback-read-dot-merlin'],
      cwd: projectPath,
      logPrefix: `ocaml-lsp:${sessionId.slice(0, 8)}`,
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
