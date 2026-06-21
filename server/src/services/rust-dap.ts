import { spawnSync } from 'child_process';
import type { WebSocket } from 'ws';
import { DapBridge, RunningDapInfo } from './dap-bridge.js';
import { listCargoTargets, type CargoTargetEntry } from './cargo-build.js';

const bridge = new DapBridge();

// Rust debug builds are native binaries with DWARF, so debugging needs only a
// stdio DAP adapter pointed at target/debug/<bin> — no bytecode rewrite or path
// translation (unlike OCaml/earlybird). `lldb-dap` (LLVM ≥ 16) is the clean
// stdio DAP server and is preferred; `lldb-vscode` is its older name. (CodeLLDB
// defaults to a TCP transport rather than stdio, so it isn't auto-selected by
// this stdio bridge.)
const ADAPTER_CANDIDATES = ['lldb-dap', 'lldb-vscode'];

function pickAdapter(): string | null {
  for (const cmd of ADAPTER_CANDIDATES) {
    try {
      const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { timeout: 2000 });
      if (r.status === 0) return cmd;
    } catch {
      // try next
    }
  }
  return null;
}

export const rustDap = {
  handleWebSocket(ws: WebSocket, sessionId: string, cwd: string): void {
    const command = pickAdapter();
    if (!command) {
      // No adapter installed — surface a DAP-shaped message so the Debug panel
      // shows a useful reason, then close.
      try {
        ws.send(JSON.stringify({
          type: 'event',
          event: 'output',
          body: {
            category: 'important',
            output: '[debug] no lldb DAP adapter found on PATH (install lldb-dap)\n',
          },
        }));
        ws.close();
      } catch {
        // ignore
      }
      return;
    }
    bridge.handleWebSocket(ws, sessionId, {
      command,
      args: [],
      cwd,
      logPrefix: `rust-dap:${sessionId.slice(0, 8)}`,
    });
  },

  isRunning(sessionId: string): boolean {
    return bridge.isRunning(sessionId);
  },

  listRunning(): RunningDapInfo[] {
    return bridge.listRunning();
  },

  stop(sessionId: string): void {
    bridge.stop(sessionId);
  },

  forceStopAll(): void {
    bridge.forceStopAll();
  },
};

// Debuggable targets are the bin executables under target/debug (a debug build
// must have run first). Reuses the cargo-build executable scan.
export function listRustDebugTargets(projectDir: string): CargoTargetEntry[] {
  return listCargoTargets(projectDir, { profile: 'dev' });
}
