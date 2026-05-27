import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Generic Debug Adapter Protocol client over WebSocket. Targeted at OCaml
// earlybird but written without OCaml-specific assumptions in the wire layer,
// so the same hook could drive another adapter if/when we add one.
//
// Lifecycle (simplified):
//   1. connect() opens the WS; server spawns ocamlearlybird
//   2. initialize → response with capabilities
//   3. launch(program, …) — adapter starts the debuggee
//   4. adapter fires `initialized` event → we push breakpoints + configurationDone
//   5. adapter starts running, may hit a breakpoint → `stopped` event
//   6. on stopped: fetch stackTrace, scopes, variables for the top frame
//   7. continue / step / pause / disconnect …
//   8. on `terminated` or WS close: state → idle and the adapter exits

export type DapState =
  | 'idle'
  | 'connecting'
  | 'initializing'
  | 'launching'
  | 'running'
  | 'stopped'
  | 'terminated';

export interface DapStackFrame {
  id: number;
  name: string;
  source?: { name?: string; path?: string };
  line: number;
  column: number;
}

export interface DapScope {
  name: string;
  variablesReference: number;
  expensive?: boolean;
}

export interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number; // 0 means no nested children
}

export interface DapBreakpoint {
  verified: boolean;
  line?: number;
  message?: string;
}

export interface DapOutputEntry {
  category: string;     // 'console' | 'stdout' | 'stderr' | 'important' | …
  text: string;
  timestamp: number;
}

export interface DapStoppedInfo {
  threadId: number;
  reason: string;       // 'breakpoint' | 'step' | 'pause' | 'exception' | …
  description?: string;
  location?: { file: string | undefined; line: number };
}

interface UseDapOptions {
  sessionId: string | undefined;
  enabled: boolean;
  // Breakpoints requested by the editor (per file URI/path). Re-sent whenever
  // it changes, so the editor can stay the source of truth.
  breakpoints: Map<string, number[]>;
  onStopped?: (info: DapStoppedInfo) => void;
  onTerminated?: () => void;
}

interface PendingRequest {
  command: string;
  resolve: (body: unknown) => void;
  reject: (err: Error) => void;
}

interface DapMessage {
  seq?: number;
  type: 'request' | 'response' | 'event';
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
}

export function useDapSession(opts: UseDapOptions) {
  const { sessionId, enabled, breakpoints, onStopped, onTerminated } = opts;

  const [state, setState] = useState<DapState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<DapOutputEntry[]>([]);
  const [frames, setFrames] = useState<DapStackFrame[]>([]);
  const [activeFrameId, setActiveFrameId] = useState<number | null>(null);
  const [scopes, setScopes] = useState<DapScope[]>([]);
  // variables keyed by scope.variablesReference
  const [variables, setVariables] = useState<Map<number, DapVariable[]>>(new Map());
  const [stoppedAt, setStoppedAt] = useState<DapStoppedInfo | null>(null);
  // Breakpoint verification status from the adapter, per file → line → verified
  const [verifiedBreakpoints, setVerifiedBreakpoints] = useState<Map<string, Map<number, boolean>>>(new Map());
  const [capabilities, setCapabilities] = useState<Record<string, unknown> | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(1);
  const pendingRef = useRef<Map<number, PendingRequest>>(new Map());
  // Map each adapter-assigned breakpoint id back to the line the user clicked,
  // so we can route delayed `breakpoint` events to the right gutter marker.
  // Outer key: source file path; inner: bp.id → origLine.
  const breakpointIdMapRef = useRef<Map<string, Map<number, number>>>(new Map());
  const launchArgsRef = useRef<{ program: string; args?: string[]; cwd?: string; stopOnEntry?: boolean } | null>(null);
  const breakpointsRef = useRef(breakpoints);
  breakpointsRef.current = breakpoints;
  const stateRef = useRef<DapState>('idle');
  stateRef.current = state;
  const onStoppedRef = useRef(onStopped);
  onStoppedRef.current = onStopped;
  const onTerminatedRef = useRef(onTerminated);
  onTerminatedRef.current = onTerminated;

  const reset = useCallback(() => {
    pendingRef.current.forEach((p) => p.reject(new Error('DAP session ended')));
    pendingRef.current.clear();
    seqRef.current = 1;
    setFrames([]);
    setActiveFrameId(null);
    setScopes([]);
    setVariables(new Map());
    setStoppedAt(null);
    setVerifiedBreakpoints(new Map());
    setCapabilities(null);
  }, []);

  const appendOutput = useCallback((category: string, text: string) => {
    if (!text) return;
    setOutput((prev) => {
      const next = [...prev, { category, text, timestamp: Date.now() }];
      // Cap to last 500 entries to keep React happy on chatty adapters.
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
  }, []);

  const sendRequest = useCallback(<T = unknown>(command: string, args?: unknown, timeoutMs = 8000): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('DAP not connected'));
        return;
      }
      const seq = seqRef.current++;
      const timer = setTimeout(() => {
        pendingRef.current.delete(seq);
        reject(new Error(`DAP request '${command}' timed out`));
      }, timeoutMs);
      pendingRef.current.set(seq, {
        command,
        resolve: (body) => { clearTimeout(timer); resolve(body as T); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      ws.send(JSON.stringify({ seq, type: 'request', command, arguments: args ?? {} }));
    });
  }, []);

  // Push the editor's current breakpoint set to the adapter for one file.
  // DAP's setBreakpoints replaces the full set for that source path.
  const pushBreakpointsForFile = useCallback(async (file: string, requestedLines: number[]) => {
    // earlybird matches breakpoints by exact (line, column) against debug
    // events. Its "trivia" tolerance (whitespace / ';' / '(*..*)' / 'in')
    // is too narrow to bridge the column=1 we'd naturally send to where the
    // actual event sits inside the line body (e.g. column 11 of
    // "  let y = x * 10 in", where `x * 10` lives). So for each requested
    // line we first ask the adapter where the valid columns are, then
    // setBreakpoints at one of those.
    type Resolved = { line: number; column?: number; origLine: number };
    const resolved: Resolved[] = [];
    // Try the exact line first, then a series of widening windows. Each
    // call is independent — if earlybird crashes on a too-large endLine
    // (its find_events indexes bols.(end_line) with no bounds check), we
    // catch and try a smaller window. Starting small avoids the crash on
    // short files; 16 lines is enough for typical OCaml let-chains and
    // small function bodies. First non-empty result wins.
    const WIDENING_WINDOWS = [0, 1, 3, 8, 16];
    for (const line of requestedLines) {
      let chosen: Resolved = { line, origLine: line };
      for (const w of WIDENING_WINDOWS) {
        try {
          const locs = await sendRequest<{ breakpoints?: Array<{ line: number; column?: number }> }>(
            'breakpointLocations',
            { source: { path: file }, line, endLine: line + w }
          );
          const positions = locs.breakpoints ?? [];
          const first = positions[0];
          if (first) {
            chosen = { line: first.line, column: first.column, origLine: line };
            if (first.line !== line) {
              appendOutput('console', `[bp L${line}] no event on this line; shifted to L${first.line}${first.column != null ? `:${first.column}` : ''}\n`);
            }
            break;
          }
        } catch {
          // out-of-bounds (short file) or unsupported — try the next window
        }
      }
      resolved.push(chosen);
    }

    try {
      const resp = await sendRequest<{ breakpoints?: DapBreakpoint[] }>('setBreakpoints', {
        source: { path: file },
        breakpoints: resolved.map((r) => (
          r.column != null ? { line: r.line, column: r.column } : { line: r.line }
        )),
      });
      const bps = resp.breakpoints ?? [];
      // Map verified status back to the user's REQUESTED lines (not the
      // resolved positions), so the gutter shows verified on the line the
      // user clicked even if the actual event was at a different column.
      const verified = new Map<number, boolean>();
      // And remember (id → origLine) so a later async `breakpoint` event
      // (earlybird's verified status flips asynchronously after the initial
      // response) can find the right line to update.
      const idMap = new Map<number, number>();
      bps.forEach((bp, i) => {
        const origLine = resolved[i]?.origLine ?? bp.line ?? requestedLines[i];
        if (typeof origLine === 'number') verified.set(origLine, !!bp.verified);
        const idAny = (bp as { id?: unknown }).id;
        if (typeof idAny === 'number' && typeof origLine === 'number') {
          idMap.set(idAny, origLine);
        }
      });
      breakpointIdMapRef.current.set(file, idMap);
      const okCount = bps.filter((b) => b.verified).length;
      const rejected = bps
        .map((b, i) => ({ b, origLine: resolved[i]?.origLine ?? b.line ?? requestedLines[i] }))
        .filter(({ b }) => !b.verified)
        .map(({ b, origLine }) => `L${origLine}${b.message ? ` (${b.message})` : ''}`)
        .join(', ');
      const summary = `[setBreakpoints ${file.split('/').pop()}] ${okCount}/${requestedLines.length} verified` +
        (rejected ? `; rejected: ${rejected}` : '') + '\n';
      appendOutput(okCount === requestedLines.length ? 'console' : 'important', summary);
      setVerifiedBreakpoints((prev) => {
        const next = new Map(prev);
        next.set(file, verified);
        return next;
      });
    } catch (err) {
      appendOutput('important', `[setBreakpoints ${file}] ${(err as Error).message}\n`);
    }
  }, [sendRequest, appendOutput]);

  const pushAllBreakpoints = useCallback(async () => {
    const all = breakpointsRef.current;
    for (const [file, lines] of all) {
      await pushBreakpointsForFile(file, lines);
    }
  }, [pushBreakpointsForFile]);

  // After we hit a 'stopped' event, gather the inspection state for the top frame.
  const refreshStackAndScopes = useCallback(async (threadId: number) => {
    try {
      const stRes = await sendRequest<{ stackFrames?: DapStackFrame[] }>('stackTrace', { threadId, startFrame: 0, levels: 50 });
      const fr = stRes.stackFrames ?? [];
      setFrames(fr);
      const top = fr[0];
      if (!top) return;
      setActiveFrameId(top.id);
      const scopeRes = await sendRequest<{ scopes?: DapScope[] }>('scopes', { frameId: top.id });
      const sc = (scopeRes.scopes ?? []).filter((s) => !s.expensive);
      setScopes(sc);
      const varEntries: Array<[number, DapVariable[]]> = await Promise.all(sc.map(async (s) => {
        try {
          const v = await sendRequest<{ variables?: DapVariable[] }>('variables', { variablesReference: s.variablesReference });
          return [s.variablesReference, v.variables ?? []] as [number, DapVariable[]];
        } catch {
          return [s.variablesReference, [] as DapVariable[]] as [number, DapVariable[]];
        }
      }));
      setVariables(new Map(varEntries));
    } catch (err) {
      appendOutput('important', `[stackTrace] ${(err as Error).message}\n`);
    }
  }, [sendRequest, appendOutput]);

  const handleMessage = useCallback((msg: DapMessage) => {
    if (msg.type === 'response' && typeof msg.request_seq === 'number') {
      const pending = pendingRef.current.get(msg.request_seq);
      if (pending) {
        pendingRef.current.delete(msg.request_seq);
        if (msg.success) pending.resolve(msg.body ?? {});
        else pending.reject(new Error(msg.message || `DAP ${pending.command} failed`));
      }
      return;
    }

    if (msg.type === 'event' && msg.event) {
      switch (msg.event) {
        case 'initialized': {
          // Adapter is ready for breakpoint setup. Push everything then
          // configurationDone — once that returns, the debuggee starts running.
          const total = Array.from(breakpointsRef.current.values()).reduce((n, ls) => n + ls.length, 0);
          appendOutput('console', `[initialized] pushing ${total} breakpoint(s) across ${breakpointsRef.current.size} file(s)\n`);
          (async () => {
            await pushAllBreakpoints();
            try {
              appendOutput('console', '[configurationDone] sent, debuggee will start\n');
              await sendRequest('configurationDone');
              setState('running');
            } catch (err) {
              appendOutput('important', `[configurationDone failed] ${(err as Error).message}\n`);
              setError((err as Error).message);
            }
          })();
          break;
        }
        case 'stopped': {
          const body = (msg.body ?? {}) as Record<string, unknown>;
          const threadId = (body.threadId as number) ?? 1;
          const reason = String(body.reason ?? 'unknown');
          const description = body.description ? String(body.description) : undefined;
          const info: DapStoppedInfo = { threadId, reason, description };
          setStoppedAt(info);
          setState('stopped');
          refreshStackAndScopes(threadId).then(() => {
            // Surface the current location (first frame) to the editor.
            setFrames((fr) => {
              const top = fr[0];
              if (top) {
                const file = top.source?.path;
                onStoppedRef.current?.({ ...info, location: { file, line: top.line } });
              } else {
                onStoppedRef.current?.(info);
              }
              return fr;
            });
          });
          break;
        }
        case 'continued': {
          setState('running');
          setFrames([]);
          setScopes([]);
          setVariables(new Map());
          setStoppedAt(null);
          break;
        }
        case 'terminated':
        case 'exited': {
          setState('terminated');
          onTerminatedRef.current?.();
          break;
        }
        case 'output': {
          const body = (msg.body ?? {}) as Record<string, unknown>;
          appendOutput(String(body.category ?? 'console'), String(body.output ?? ''));
          break;
        }
        case 'breakpoint': {
          // Earlybird resolves breakpoints asynchronously after the initial
          // setBreakpoints response — the response always says
          // verified=false, then later a `breakpoint` event with
          // reason='changed' flips it to verified=true once the pc is
          // registered in the debuggee. Without handling this event the
          // gutter ring would stay hollow even when the breakpoint hits.
          const body = (msg.body ?? {}) as Record<string, unknown>;
          const bp = (body.breakpoint ?? {}) as { id?: number; verified?: boolean; message?: string };
          const id = typeof bp.id === 'number' ? bp.id : undefined;
          const isVerified = !!bp.verified;
          if (id !== undefined) {
            for (const [file, idMap] of breakpointIdMapRef.current) {
              const origLine = idMap.get(id);
              if (origLine !== undefined) {
                setVerifiedBreakpoints((prev) => {
                  const next = new Map(prev);
                  const fileMap = new Map(next.get(file) ?? new Map<number, boolean>());
                  fileMap.set(origLine, isVerified);
                  next.set(file, fileMap);
                  return next;
                });
                appendOutput('console', `[bp event] ${file.split('/').pop()} L${origLine} → verified=${isVerified}${bp.message ? ` (${bp.message})` : ''}\n`);
                break;
              }
            }
          }
          break;
        }
        // thread / module — not surfaced in the v1 UI
      }
    }
  }, [pushAllBreakpoints, sendRequest, refreshStackAndScopes, appendOutput]);

  const disconnect = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN && stateRef.current !== 'idle') {
        await sendRequest('disconnect', { terminateDebuggee: true }, 1500).catch(() => {});
      }
    } finally {
      try { ws.close(); } catch { /* */ }
    }
  }, [sendRequest]);

  // Launches a fresh debug session. Tears down any prior WS first.
  const launch = useCallback(async (program: string, args?: string[], cwd?: string, stopOnEntry = false) => {
    if (!sessionId || !enabled) return;
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* */ }
      wsRef.current = null;
    }
    reset();
    setError(null);
    setOutput([]);
    setState('connecting');
    launchArgsRef.current = { program, args, cwd, stopOnEntry };

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/debug/${sessionId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = async () => {
      appendOutput('console', `[ws] connected, sending initialize for ${program}\n`);
      setState('initializing');
      try {
        const initBody = await sendRequest<Record<string, unknown>>('initialize', {
          clientID: 'pyramid',
          clientName: 'Pyramid',
          adapterID: 'ocaml',
          locale: 'en',
          linesStartAt1: true,
          columnsStartAt1: true,
          pathFormat: 'path',
          supportsVariableType: true,
          supportsVariablePaging: false,
          supportsRunInTerminalRequest: false,
        });
        setCapabilities(initBody);
        appendOutput('console', `[init] adapter ready, sending launch (stopOnEntry=${stopOnEntry})\n`);
        setState('launching');
        await sendRequest('launch', {
          name: 'OCaml Debug',
          type: 'ocaml',
          request: 'launch',
          program,
          arguments: args ?? [],
          cwd,
          stopOnEntry,
          // earlybird honors `console: "internalConsole"` and forwards
          // debuggee stdout/stderr as `output` events with categories
          // 'stdout' / 'stderr' — exactly what the panel renders.
          console: 'internalConsole',
        });
        appendOutput('console', '[launch] accepted, waiting for `initialized` event\n');
        // After launch the adapter will fire `initialized`, which is what
        // drives the breakpoint push + configurationDone in handleMessage.
      } catch (err) {
        appendOutput('important', `[launch failed] ${(err as Error).message}\n`);
        setError((err as Error).message);
        setState('terminated');
        try { ws.close(); } catch { /* */ }
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg: DapMessage = JSON.parse(ev.data);
        handleMessage(msg);
      } catch {
        /* malformed — ignore */
      }
    };

    ws.onclose = (ev) => {
      // Note: console.log here is intentional — if this fires while state is
      // 'launching' or 'initializing', something tore down the WS prematurely
      // (the most common cause we've seen is React StrictMode re-running an
      // effect cleanup during dev). The reason/code helps tell the difference.
      console.log(`[dap] ws close code=${ev.code} reason="${ev.reason}" wasClean=${ev.wasClean} state=${stateRef.current}`);
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      pendingRef.current.forEach((p) => p.reject(new Error('DAP WebSocket closed')));
      pendingRef.current.clear();
      if (stateRef.current !== 'idle') setState('idle');
      onTerminatedRef.current?.();
    };

    ws.onerror = () => {
      setError('DAP WebSocket error');
    };
  }, [sessionId, enabled, sendRequest, handleMessage, reset]);

  // High-level control wrappers. Each is a no-op when not stopped.
  // Default threadId is 0 (earlybird's convention); most adapters use 1 but
  // earlybird's lifecycle.ml hardcodes thread_id=0 in its stopped events.
  // When we actually have a `stopped` event, prefer its threadId.
  const cont = useCallback(async () => {
    if (stateRef.current !== 'stopped') return;
    const threadId = stoppedAt?.threadId ?? 0;
    try { await sendRequest('continue', { threadId }); }
    catch (err) { appendOutput('important', `[continue] ${(err as Error).message}\n`); }
  }, [sendRequest, stoppedAt, appendOutput]);

  const next = useCallback(async () => {
    if (stateRef.current !== 'stopped') return;
    const threadId = stoppedAt?.threadId ?? 0;
    try { await sendRequest('next', { threadId }); }
    catch (err) { appendOutput('important', `[next] ${(err as Error).message}\n`); }
  }, [sendRequest, stoppedAt, appendOutput]);

  const stepIn = useCallback(async () => {
    if (stateRef.current !== 'stopped') return;
    const threadId = stoppedAt?.threadId ?? 0;
    try { await sendRequest('stepIn', { threadId }); }
    catch (err) { appendOutput('important', `[stepIn] ${(err as Error).message}\n`); }
  }, [sendRequest, stoppedAt, appendOutput]);

  const stepOut = useCallback(async () => {
    if (stateRef.current !== 'stopped') return;
    const threadId = stoppedAt?.threadId ?? 0;
    try { await sendRequest('stepOut', { threadId }); }
    catch (err) { appendOutput('important', `[stepOut] ${(err as Error).message}\n`); }
  }, [sendRequest, stoppedAt, appendOutput]);

  const pause = useCallback(async () => {
    if (stateRef.current !== 'running') return;
    try { await sendRequest('pause', { threadId: 0 }); }
    catch (err) { appendOutput('important', `[pause] ${(err as Error).message}\n`); }
  }, [sendRequest, appendOutput]);

  // Live-update the adapter when the user toggles a breakpoint mid-session.
  // No-op when no debug session is active. State is read via the ref so it
  // doesn't appear in the dep list — including it caused a redundant push on
  // every state transition (initializing → launching → running), which
  // collided with the initial push from the `initialized` handler.
  useEffect(() => {
    const s = stateRef.current;
    if (s === 'idle' || s === 'connecting' || s === 'initializing' || s === 'launching') return;
    pushAllBreakpoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakpoints]);

  // Tear down on unmount or when enabled flips off.
  useEffect(() => {
    if (!enabled) {
      disconnect();
      setState('idle');
    }
    return () => {
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* */ }
        wsRef.current = null;
      }
    };
  }, [enabled, disconnect]);

  return useMemo(() => ({
    state,
    error,
    output,
    frames,
    activeFrameId,
    scopes,
    variables,
    stoppedAt,
    verifiedBreakpoints,
    capabilities,
    launch,
    disconnect,
    continue: cont,
    next,
    stepIn,
    stepOut,
    pause,
  }), [
    state, error, output, frames, activeFrameId, scopes, variables, stoppedAt,
    verifiedBreakpoints, capabilities,
    launch, disconnect, cont, next, stepIn, stepOut, pause,
  ]);
}
