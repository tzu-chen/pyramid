import { spawn, ChildProcess } from 'child_process';
import type { WebSocket } from 'ws';

// Debug Adapter Protocol bridge. Differs from LspBridge in three important ways:
//   1. **Per-debug-session lifecycle.** A debug adapter is spawned per WS
//      connection and killed when the client disconnects or the adapter exits.
//      No reconnection caching, no idle timeout — a debug session is bound to
//      a single client tab.
//   2. **Single client per session.** DAP is inherently 1:1 between adapter
//      and client. A new connection for an in-progress session terminates the
//      old one (closing the WS) before starting a fresh adapter.
//   3. **No initialize caching.** Each DAP session does its own initialize +
//      launch dance; there's nothing useful to cache.
//
// Wire format is the same as LSP: Content-Length-framed JSON over stdio.
// We do no message inspection — the bridge is a transparent relay.

export interface DapAdapterConfig {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logPrefix: string;   // e.g., 'ocaml-dap:abc12345'
  // Optional path translation applied to each JSON message. Used by the OCaml
  // wrapper to swap dune's /workspace_root placeholder (rewritten to a real
  // session-specific symlink path before launch) back into the real session
  // path for the client, and vice versa. See bc-fixup.ts.
  //
  // `virtual` and `real` must be the same byte length so the rewritten
  // bytecode stays a valid OCaml marshal stream — we only replace, never
  // resize.
  pathTranslation?: { virtual: string; real: string };
}

interface DapAdapter {
  process: ChildProcess;
  config: DapAdapterConfig;
  client: WebSocket;
  stdoutBuffer: Buffer;
  startedAt: number;
}

export interface RunningDapInfo {
  session_id: string;
  pid: number | null;
  started_at: number;
}

const HEADER_SEPARATOR = Buffer.from('\r\n\r\n');
const CONTENT_LENGTH_PREFIX = Buffer.from('Content-Length: ');

function sendToAdapter(da: DapAdapter, message: string): void {
  const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
  da.process.stdin?.write(header + message);
}

// Path translations are intentionally string-replacements on the raw JSON,
// not parse-then-rewrite. The placeholder and replacement have identical byte
// lengths (see bc-fixup.ts) so this is safe in JSON-encoded form. Doing it on
// the JSON string avoids allocating object graphs for every event.
function translateToClient(msg: string, t?: { virtual: string; real: string }): string {
  if (!t) return msg;
  // The virtual path can appear bare or JSON-escaped (forward slashes are
  // not escaped by JSON.stringify but a careful adapter might). We handle
  // both for safety.
  return msg.split(t.virtual).join(t.real);
}

function translateToAdapter(msg: string, t?: { virtual: string; real: string }): string {
  if (!t) return msg;
  return msg.split(t.real).join(t.virtual);
}

function processStdout(da: DapAdapter): void {
  while (true) {
    const prefixIdx = da.stdoutBuffer.indexOf(CONTENT_LENGTH_PREFIX);
    if (prefixIdx === -1) break;

    const separatorIdx = da.stdoutBuffer.indexOf(HEADER_SEPARATOR, prefixIdx);
    if (separatorIdx === -1) break;

    const lengthStr = da.stdoutBuffer.slice(prefixIdx + CONTENT_LENGTH_PREFIX.length, separatorIdx).toString('ascii');
    const contentLength = parseInt(lengthStr, 10);
    if (isNaN(contentLength)) break;

    const messageStart = separatorIdx + HEADER_SEPARATOR.length;
    const messageEnd = messageStart + contentLength;

    if (da.stdoutBuffer.length < messageEnd) break;

    const message = da.stdoutBuffer.slice(messageStart, messageEnd).toString('utf-8');
    da.stdoutBuffer = da.stdoutBuffer.slice(messageEnd);

    if (da.client.readyState === 1) { // WebSocket.OPEN
      da.client.send(translateToClient(message, da.config.pathTranslation));
    }
  }
}

export class DapBridge {
  private adapters = new Map<string, DapAdapter>();

  handleWebSocket(ws: WebSocket, sessionId: string, config: DapAdapterConfig): void {
    // Replace any in-flight session for this session id. Real-world cause:
    // user clicks Debug again before the previous adapter has been reaped.
    const existing = this.adapters.get(sessionId);
    if (existing) {
      try { existing.client.close(); } catch { /* */ }
      try { existing.process.kill('SIGKILL'); } catch { /* */ }
      this.adapters.delete(sessionId);
    }

    const proc = spawn(config.command, config.args, {
      cwd: config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: config.env,
    });

    const da: DapAdapter = {
      process: proc,
      config,
      client: ws,
      stdoutBuffer: Buffer.alloc(0),
      startedAt: Date.now(),
    };
    this.adapters.set(sessionId, da);

    proc.stdout?.on('data', (data: Buffer) => {
      da.stdoutBuffer = Buffer.concat([da.stdoutBuffer, data]);
      processStdout(da);
    });

    // earlybird and most adapters log diagnostics on stderr — surface them
    // back to the client as DAP `output` events so they show up in the
    // debug panel's log area.
    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.trim()) console.error(`[${config.logPrefix}] ${msg.trim()}`);
      if (da.client.readyState === 1) {
        da.client.send(JSON.stringify({
          type: 'event',
          event: 'output',
          body: { category: 'stderr', output: msg },
        }));
      }
    });

    proc.on('close', (code) => {
      console.log(`[${config.logPrefix}] adapter exited with code ${code}`);
      // Mirror normal DAP shutdown so the client doesn't hang waiting for
      // a terminated event the adapter never sent (e.g. on crash).
      if (da.client.readyState === 1) {
        try {
          da.client.send(JSON.stringify({
            type: 'event',
            event: 'terminated',
            body: { restart: false },
          }));
          da.client.send(JSON.stringify({
            type: 'event',
            event: 'exited',
            body: { exitCode: code ?? 0 },
          }));
        } catch { /* */ }
        try { da.client.close(); } catch { /* */ }
      }
      if (this.adapters.get(sessionId) === da) this.adapters.delete(sessionId);
    });

    proc.on('error', (err) => {
      console.error(`[${config.logPrefix}] spawn error: ${err.message}`);
      if (da.client.readyState === 1) {
        try {
          da.client.send(JSON.stringify({
            type: 'event',
            event: 'output',
            body: { category: 'important', output: `[spawn error] ${err.message}\n` },
          }));
          da.client.close();
        } catch { /* */ }
      }
      if (this.adapters.get(sessionId) === da) this.adapters.delete(sessionId);
    });

    ws.on('message', (data) => {
      const message = translateToAdapter(data.toString(), da.config.pathTranslation);
      sendToAdapter(da, message);
    });

    ws.on('close', (code, reason) => {
      // Logging both the WS close code and PID so we can tell, when an
      // `adapter exited with code null` line appears in the server log,
      // whether the kill came from us (client tore down WS first) or from
      // earlybird (it exited and we noticed). Close code 1000 = normal,
      // 1001 = going away, 1006 = abnormal (network).
      const reasonStr = reason?.toString() || '';
      console.log(`[${config.logPrefix}] ws closed: code=${code} reason="${reasonStr}" pid=${proc.pid}`);
      try { proc.kill('SIGTERM'); } catch { /* already dead */ }
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, 2000);
      if (this.adapters.get(sessionId) === da) this.adapters.delete(sessionId);
    });

    ws.on('error', (err) => {
      console.error(`[${config.logPrefix}] ws error: ${err.message}`);
      try { proc.kill('SIGKILL'); } catch { /* */ }
      if (this.adapters.get(sessionId) === da) this.adapters.delete(sessionId);
    });
  }

  stop(sessionId: string): void {
    const da = this.adapters.get(sessionId);
    if (!da) return;
    try { da.client.close(); } catch { /* */ }
    try { da.process.kill('SIGTERM'); } catch { /* */ }
    setTimeout(() => {
      try { da.process.kill('SIGKILL'); } catch { /* */ }
    }, 1000);
    this.adapters.delete(sessionId);
  }

  isRunning(sessionId: string): boolean {
    return this.adapters.has(sessionId);
  }

  listRunning(): RunningDapInfo[] {
    return Array.from(this.adapters.entries()).map(([sessionId, da]) => ({
      session_id: sessionId,
      pid: da.process.pid ?? null,
      started_at: da.startedAt,
    }));
  }

  forceStopAll(): void {
    for (const [sessionId, da] of this.adapters) {
      try { da.client.close(); } catch { /* */ }
      try { da.process.kill('SIGKILL'); } catch { /* */ }
      this.adapters.delete(sessionId);
    }
  }
}
