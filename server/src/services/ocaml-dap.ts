import fs from 'fs';
import path from 'path';
import type { WebSocket } from 'ws';
import { DapBridge, RunningDapInfo } from './dap-bridge.js';
import { ensureSymlink, symlinkPath, rewriteBytecodeFiles } from './bc-fixup.js';

const bridge = new DapBridge();

export const ocamlDap = {
  handleWebSocket(ws: WebSocket, sessionId: string, cwd: string): void {
    // Safety net: re-run the bytecode fixup on connect. The route-level hook
    // already runs it after every dune build, but this catches the case
    // where the user clicked Debug without rebuilding first (stale .bc still
    // has /workspace_root), or where a server reload missed the route hook.
    // The rewrite is a no-op when nothing needs patching.
    try {
      const patched = rewriteBytecodeFiles(path.join(cwd, '_build'), sessionId, cwd);
      if (patched > 0) {
        console.log(`[ocaml-dap:${sessionId.slice(0, 8)}] patched ${patched} .bc file(s) on connect`);
      }
    } catch (err) {
      console.error(`[ocaml-dap:${sessionId.slice(0, 8)}] bc-fixup on connect failed: ${(err as Error).message}`);
    }
    // Make sure the per-session symlink exists. (rewriteBytecodeFiles also
    // calls this internally but we call it again here so the debug session
    // works even when no .bc needed patching — e.g. the user already built
    // with patched .bc but the symlink got cleaned up.)
    ensureSymlink(sessionId, cwd);
    const virtualPath = symlinkPath(sessionId);
    bridge.handleWebSocket(ws, sessionId, {
      command: 'ocamlearlybird',
      // `info` verbosity surfaces high-level adapter lifecycle (connect /
      // launch / state transitions) into the debug panel via the bridge's
      // stderr → DAP output forwarding, without flooding it with the
      // per-message dump that `debug` produces.
      args: ['debug', '--verbosity=info'],
      cwd,
      logPrefix: `ocaml-dap:${sessionId.slice(0, 8)}`,
      // Translate paths in DAP messages so the client always sees the real
      // session path even though earlybird internally references the symlink.
      pathTranslation: { virtual: virtualPath, real: cwd },
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

// ── Helpers for listing bytecode targets ──
//
// earlybird debugs OCaml *bytecode*. Dune produces native binaries by default;
// the user needs `(modes byte exe)` on their executable stanza (or
// `(modes byte)` only) to emit a .bc artifact. This helper walks the dune
// build dir and returns every .bc file it finds so the client can populate a
// target picker and report a useful error when none exist.

export interface BytecodeTarget {
  name: string;
  path: string; // absolute
}

export function listBytecodeTargets(projectDir: string, _profile: string): BytecodeTarget[] {
  // Dune writes every profile into the same context dir (`_build/default/`);
  // the `profile` arg is accepted for API parity with the CMake side but
  // ignored here. See dune-build.ts BUILD_CONTEXT for the full story.
  const buildDir = path.join(projectDir, '_build', 'default');
  if (!fs.existsSync(buildDir)) return [];

  const out: BytecodeTarget[] = [];
  const SKIP = new Set(['.dune', '.dune-cache', '_doc', '_unused', '.merlin-conf']);
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP.has(ent.name)) continue;
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (ent.name.toLowerCase().endsWith('.bc')) {
        out.push({ name: path.basename(ent.name, '.bc'), path: full });
      }
    }
  };
  walk(buildDir);
  return out;
}
