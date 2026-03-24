import { useState, useEffect, useRef, useCallback } from 'react';
import { LspDiagnostic } from '../components/CodeEditor/CodeEditor';

interface LspState {
  connected: boolean;
  initialized: boolean;
  diagnostics: LspDiagnostic[];
  goalState: string | null;
  messages: string[];
}

export function useLeanLsp(sessionId: string | undefined, enabled: boolean, projectPath: string | null = null) {
  const [state, setState] = useState<LspState>({
    connected: false,
    initialized: false,
    diagnostics: [],
    goalState: null,
    messages: [],
  });

  const wsRef = useRef<WebSocket | null>(null);
  const requestIdRef = useRef(1);
  const pendingRef = useRef<Map<number, string>>(new Map()); // id -> method
  const versionRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileUriRef = useRef<string | null>(null);
  const fileOpenedRef = useRef(false);

  const connect = useCallback(() => {
    if (!sessionId || !enabled || (enabled && !projectPath)) return;

    // Cancel any pending reconnect from a previous connection
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Close any existing connection cleanly before creating a new one
    if (wsRef.current) {
      const oldWs = wsRef.current;
      wsRef.current = null; // Clear ref BEFORE closing so onclose knows it's stale
      oldWs.onclose = null; // Remove handler to prevent stale onclose from firing
      oldWs.onerror = null;
      oldWs.onmessage = null;
      oldWs.close();
    }

    // Determine WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/lean/${sessionId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(s => ({ ...s, connected: true }));

      // Send LSP initialize request
      const initId = requestIdRef.current++;
      pendingRef.current.set(initId, 'initialize');

      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: initId,
        method: 'initialize',
        params: {
          processId: null,
          capabilities: {
            textDocument: {
              synchronization: {
                dynamicRegistration: false,
                willSave: false,
                didSave: true,
                willSaveWaitUntil: false,
              },
              completion: {
                dynamicRegistration: false,
                completionItem: { snippetSupport: false },
              },
              hover: { dynamicRegistration: false },
              definition: { dynamicRegistration: false },
              publishDiagnostics: { relatedInformation: true },
            },
          },
          rootUri: projectPath ? `file://${projectPath}` : null,
          workspaceFolders: projectPath ? [{ uri: `file://${projectPath}`, name: 'pyramid-session' }] : null,
        },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Handle response to our request (has id, but NO method — distinguishes
        // responses from server-initiated requests like window/workDoneProgress/create
        // which also carry an id)
        if (msg.id !== undefined && msg.id !== null && !msg.method) {
          const method = pendingRef.current.get(msg.id);
          pendingRef.current.delete(msg.id);

          if (method === 'initialize') {
            // Send initialized notification
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              method: 'initialized',
              params: {},
            }));
            setState(s => ({ ...s, initialized: true }));
          } else if (method === '$/lean/plainGoal') {
            if (msg.result) {
              const rendered = msg.result.rendered || msg.result.goals?.join('\n\n') || '';
              setState(s => ({ ...s, goalState: rendered || null }));
            } else if (msg.error) {
              console.warn('[lean-lsp] plainGoal error:', msg.error.code, msg.error.message || msg.error);
              setState(s => ({ ...s, goalState: null }));
            } else {
              setState(s => ({ ...s, goalState: null }));
            }
          }
        }

        // Handle server-initiated requests (has both id and method) — respond
        // so Lean doesn't hang waiting
        if (msg.id !== undefined && msg.id !== null && msg.method) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: null,
          }));
        }

        // Handle notifications (has method, no id)
        if (msg.method) {
          if (msg.method === 'textDocument/publishDiagnostics') {
            const diags: LspDiagnostic[] = (msg.params.diagnostics || []).map((d: {
              range: { start: { line: number; character: number }; end: { line: number; character: number } };
              message: string;
              severity?: number;
            }) => ({
              range: d.range,
              message: d.message,
              severity: d.severity,
            }));
            setState(s => ({ ...s, diagnostics: diags }));
          } else if (msg.method === 'window/logMessage' || msg.method === 'window/showMessage') {
            const text = msg.params?.message || '';
            if (text) {
              setState(s => ({ ...s, messages: [...s.messages.slice(-99), text] }));
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      // Only reset state if this is still the current WebSocket.
      // If a newer WS has already replaced us (wsRef.current !== ws),
      // this is a stale close event — ignore it to avoid corrupting
      // the newer connection's state.
      if (wsRef.current !== ws) return;

      setState(s => ({ ...s, connected: false, initialized: false }));
      wsRef.current = null;
      fileOpenedRef.current = false;
      requestIdRef.current = 1;
      pendingRef.current.clear();
      versionRef.current = 0;

      // Reconnect after delay
      if (enabled) {
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, 3000);
      }
    };

    ws.onerror = () => {
      // onclose will handle reconnection
    };
  }, [sessionId, enabled, projectPath]);

  useEffect(() => {
    if (enabled && sessionId) {
      connect();
    }

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        const oldWs = wsRef.current;
        wsRef.current = null;
        oldWs.onclose = null; // Prevent stale onclose handler
        oldWs.onerror = null;
        oldWs.onmessage = null;
        oldWs.close();
      }
      fileOpenedRef.current = false;
    };
  }, [connect, enabled, sessionId]);

  // Use ref for initialized check so callbacks remain stable
  const initializedRef = useRef(false);
  initializedRef.current = state.initialized;

  const sendDidOpen = useCallback((uri: string, content: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !initializedRef.current) return;

    fileUriRef.current = uri;
    versionRef.current = 1;
    fileOpenedRef.current = true;

    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          languageId: 'lean4',
          version: versionRef.current,
          text: content,
        },
      },
    }));
  }, []);

  const sendDidChange = useCallback((uri: string, content: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !initializedRef.current) return;

    // If file hasn't been opened yet, open it first
    if (!fileOpenedRef.current) {
      sendDidOpen(uri, content);
      return;
    }

    versionRef.current++;
    fileUriRef.current = uri;

    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri, version: versionRef.current },
        contentChanges: [{ text: content }],
      },
    }));
  }, [sendDidOpen]);

  const requestGoalState = useCallback((uri: string, line: number, character: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !initializedRef.current) return;

    const id = requestIdRef.current++;
    pendingRef.current.set(id, '$/lean/plainGoal');

    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: '$/lean/plainGoal',
      params: {
        textDocument: { uri },
        position: { line, character },
      },
    }));
  }, []);

  return {
    connected: state.connected,
    initialized: state.initialized,
    diagnostics: state.diagnostics,
    goalState: state.goalState,
    messages: state.messages,
    sendDidOpen,
    sendDidChange,
    requestGoalState,
  };
}
