import { useState, useEffect, useRef, useCallback } from 'react';
import { LspDiagnostic } from '../components/CodeEditor/CodeEditor';

interface LspState {
  connected: boolean;
  initialized: boolean;
  diagnostics: LspDiagnostic[];
  messages: string[];
}

export interface CppCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText?: string;
  filterText?: string;
}

export interface CppHoverResult {
  contents: string;
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

// Hierarchical DocumentSymbol (LSP spec). clangd returns this shape when the
// client advertises hierarchicalDocumentSymbolSupport.
export interface CppDocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: CppDocumentSymbol[];
}

export function useCppLsp(sessionId: string | undefined, enabled: boolean, projectPath: string | null = null) {
  const [state, setState] = useState<LspState>({
    connected: false,
    initialized: false,
    diagnostics: [],
    messages: [],
  });

  const wsRef = useRef<WebSocket | null>(null);
  const requestIdRef = useRef(1);
  const pendingRef = useRef<Map<number, { method: string; resolve: (val: unknown) => void; reject: (err: unknown) => void }>>(new Map());
  const versionRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileUriRef = useRef<string | null>(null);
  const fileOpenedRef = useRef(false);
  const diagnosticsByUriRef = useRef<Map<string, LspDiagnostic[]>>(new Map());

  const connect = useCallback(() => {
    if (!sessionId || !enabled || (enabled && !projectPath)) return;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      const oldWs = wsRef.current;
      wsRef.current = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      oldWs.onmessage = null;
      oldWs.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/cpp/${sessionId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(s => ({ ...s, connected: true }));

      const initId = requestIdRef.current++;
      pendingRef.current.set(initId, {
        method: 'initialize',
        resolve: () => { /* handled inline below */ },
        reject: () => { /* */ },
      });

      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: initId,
        method: 'initialize',
        params: {
          processId: null,
          rootUri: projectPath ? `file://${projectPath}` : null,
          workspaceFolders: projectPath ? [{ uri: `file://${projectPath}`, name: 'pyramid-cpp-session' }] : null,
          capabilities: {
            textDocument: {
              synchronization: { dynamicRegistration: false },
              completion: {
                dynamicRegistration: false,
                completionItem: { snippetSupport: false, documentationFormat: ['plaintext'] },
              },
              hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
              definition: { dynamicRegistration: false },
              documentSymbol: {
                dynamicRegistration: false,
                hierarchicalDocumentSymbolSupport: true,
              },
              publishDiagnostics: { relatedInformation: true },
            },
          },
        },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Response to our request (has id, no method)
        if (msg.id !== undefined && msg.id !== null && !msg.method) {
          const pending = pendingRef.current.get(msg.id);
          if (pending) {
            pendingRef.current.delete(msg.id);
            if (pending.method === 'initialize') {
              ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }));
              setState(s => ({ ...s, initialized: true }));
            } else if (msg.error) {
              pending.reject(msg.error);
            } else {
              pending.resolve(msg.result);
            }
          }
        }

        // Server-initiated request (has id and method) — respond null so clangd doesn't hang
        if (msg.id !== undefined && msg.id !== null && msg.method) {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: null }));
        }

        // Notifications (method, no id)
        if (msg.method && (msg.id === undefined || msg.id === null)) {
          if (msg.method === 'textDocument/publishDiagnostics') {
            const uri: string = msg.params?.uri || '';
            const diags: LspDiagnostic[] = (msg.params?.diagnostics || []).map((d: {
              range: { start: { line: number; character: number }; end: { line: number; character: number } };
              message: string;
              severity?: number;
            }) => ({
              range: d.range,
              message: d.message,
              severity: d.severity,
            }));
            diagnosticsByUriRef.current.set(uri, diags);
            // Surface diagnostics for the currently-open file only
            if (fileUriRef.current && uri === fileUriRef.current) {
              setState(s => ({ ...s, diagnostics: diags }));
            }
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
      if (wsRef.current !== ws) return;

      setState(s => ({ ...s, connected: false, initialized: false }));
      wsRef.current = null;
      fileOpenedRef.current = false;
      requestIdRef.current = 1;
      pendingRef.current.clear();
      versionRef.current = 0;

      if (enabled) {
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, 3000);
      }
    };

    ws.onerror = () => {
      // onclose handles reconnect
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
        oldWs.onclose = null;
        oldWs.onerror = null;
        oldWs.onmessage = null;
        oldWs.close();
      }
      fileOpenedRef.current = false;
    };
  }, [connect, enabled, sessionId]);

  const initializedRef = useRef(false);
  initializedRef.current = state.initialized;

  const sendDidOpen = useCallback((uri: string, content: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !initializedRef.current) return;

    fileUriRef.current = uri;
    versionRef.current = 1;
    fileOpenedRef.current = true;

    // Restore cached diagnostics for the new file (if any)
    const cached = diagnosticsByUriRef.current.get(uri) || [];
    setState(s => ({ ...s, diagnostics: cached }));

    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          languageId: 'cpp',
          version: versionRef.current,
          text: content,
        },
      },
    }));
  }, []);

  const sendDidChange = useCallback((uri: string, content: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !initializedRef.current) return;

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

  const sendRequest = useCallback(<T,>(method: string, params: unknown, timeoutMs = 4000): Promise<T | null> => {
    return new Promise<T | null>((resolve) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !initializedRef.current) {
        resolve(null);
        return;
      }

      const id = requestIdRef.current++;
      const timer = setTimeout(() => {
        pendingRef.current.delete(id);
        resolve(null);
      }, timeoutMs);

      pendingRef.current.set(id, {
        method,
        resolve: (val: unknown) => { clearTimeout(timer); resolve((val ?? null) as T | null); },
        reject: () => { clearTimeout(timer); resolve(null); },
      });

      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }, []);

  const requestCompletion = useCallback(async (uri: string, line: number, character: number) => {
    const result = await sendRequest<{ items?: CppCompletionItem[] } | CppCompletionItem[]>(
      'textDocument/completion',
      { textDocument: { uri }, position: { line, character } },
    );
    if (!result) return [];
    if (Array.isArray(result)) return result;
    return result.items || [];
  }, [sendRequest]);

  const requestDocumentSymbols = useCallback(async (uri: string): Promise<CppDocumentSymbol[]> => {
    const result = await sendRequest<unknown>(
      'textDocument/documentSymbol',
      { textDocument: { uri } },
      6000,
    );
    if (!result || !Array.isArray(result)) return [];

    // clangd returns DocumentSymbol[] when hierarchical support is advertised.
    // Fall back to the flat SymbolInformation[] shape if a server ever returns it.
    const first = result[0] as Record<string, unknown> | undefined;
    if (first && 'location' in first && !('range' in first)) {
      const flat = result as Array<{
        name: string;
        kind: number;
        location: { range: LspRange };
        containerName?: string;
      }>;
      return flat.map(s => ({
        name: s.name,
        kind: s.kind,
        range: s.location.range,
        selectionRange: s.location.range,
        detail: s.containerName,
      }));
    }
    return result as CppDocumentSymbol[];
  }, [sendRequest]);

  const requestHover = useCallback(async (uri: string, line: number, character: number) => {
    const result = await sendRequest<{ contents?: unknown } | null>(
      'textDocument/hover',
      { textDocument: { uri }, position: { line, character } },
    );
    if (!result || !result.contents) return null;
    const contents = result.contents;
    let text = '';
    if (typeof contents === 'string') {
      text = contents;
    } else if (Array.isArray(contents)) {
      text = contents.map(c => typeof c === 'string' ? c : (c as { value?: string }).value || '').join('\n\n');
    } else if (typeof contents === 'object') {
      text = (contents as { value?: string }).value || '';
    }
    return text ? { contents: text } : null;
  }, [sendRequest]);

  return {
    connected: state.connected,
    initialized: state.initialized,
    diagnostics: state.diagnostics,
    messages: state.messages,
    sendDidOpen,
    sendDidChange,
    requestCompletion,
    requestHover,
    requestDocumentSymbols,
  };
}
