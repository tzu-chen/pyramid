import { useCallback, useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

export type TerminalStatus = 'connecting' | 'connected' | 'closed';

interface UseTerminalOptions {
  sessionId: string;
  tabId: string;
  term: Terminal | null;
  fitAddon: FitAddon | null;
  enabled: boolean;
}

export function useTerminal({ sessionId, tabId, term, fitAddon, enabled }: UseTerminalOptions) {
  const [status, setStatus] = useState<TerminalStatus>('closed');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDimsRef = useRef<{ cols: number; rows: number } | null>(null);

  const sendResize = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !term) return;
    const cols = term.cols;
    const rows = term.rows;
    const last = lastDimsRef.current;
    if (last && last.cols === cols && last.rows === rows) return;
    lastDimsRef.current = { cols, rows };
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }, [term]);

  const connect = useCallback(() => {
    if (!enabled || !term) return;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      const old = wsRef.current;
      wsRef.current = null;
      old.onclose = null; old.onerror = null; old.onmessage = null; old.onopen = null;
      try { old.close(); } catch { /* */ }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws/terminal/${sessionId}/${tabId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus('connecting');

    ws.onopen = () => {
      setStatus('connected');
      try { fitAddon?.fit(); } catch { /* */ }
      lastDimsRef.current = null;
      sendResize();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setStatus('closed');
      if (enabled) {
        reconnectTimerRef.current = setTimeout(() => connect(), 3000);
      }
    };

    ws.onerror = () => { /* onclose handles reconnect */ };
  }, [enabled, term, fitAddon, sessionId, tabId, sendResize]);

  // Manage WebSocket lifecycle
  useEffect(() => {
    if (enabled && term) connect();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const old = wsRef.current;
      if (old) {
        wsRef.current = null;
        old.onclose = null; old.onerror = null; old.onmessage = null; old.onopen = null;
        try { old.close(); } catch { /* */ }
      }
    };
  }, [connect, enabled, term]);

  // Forward user input from xterm to ws
  useEffect(() => {
    if (!term) return;
    const dataHandler = term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
    return () => dataHandler.dispose();
  }, [term]);

  // Forward resize events from xterm to ws
  useEffect(() => {
    if (!term) return;
    const resizeHandler = term.onResize(() => sendResize());
    return () => resizeHandler.dispose();
  }, [term, sendResize]);

  const kill = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'kill' })); } catch { /* */ }
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (ws) {
      wsRef.current = null;
      ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.onopen = null;
      try { ws.close(); } catch { /* */ }
    }
    setStatus('closed');
  }, []);

  return { status, fit: sendResize, kill };
}
