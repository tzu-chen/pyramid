import { useCallback, useEffect, useRef, useState } from 'react';

export type KernelStatus = 'disconnected' | 'connecting' | 'starting' | 'idle' | 'busy';

export interface CellOutput {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error';
  name?: 'stdout' | 'stderr';
  text?: string;
  data?: Record<string, string>;
  execution_count?: number | null;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

interface KernelEvent {
  type: string;
  parent_msg_id?: string;
  [key: string]: unknown;
}

interface UseNotebookKernelOptions {
  sessionId: string | undefined;
  enabled: boolean;
  onCellEvent: (cellId: string, event: KernelEvent) => void;
}

export interface CompletionResult {
  matches: string[];
  cursor_start: number;
  cursor_end: number;
  metadata?: { _jupyter_types_experimental?: Array<{ text: string; type?: string; signature?: string }> };
}

export function useNotebookKernel({ sessionId, enabled, onCellEvent }: UseNotebookKernelOptions) {
  const [status, setStatus] = useState<KernelStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const msgIdToCellRef = useRef<Map<string, string>>(new Map());
  const completionPendingRef = useRef<Map<string, (r: CompletionResult) => void>>(new Map());
  const runningCellRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCellEventRef = useRef(onCellEvent);
  onCellEventRef.current = onCellEvent;

  const connect = useCallback(() => {
    if (!sessionId || !enabled) return;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      const old = wsRef.current;
      wsRef.current = null;
      old.onclose = null; old.onerror = null; old.onmessage = null;
      old.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws/notebook/${sessionId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus('connecting');

    ws.onopen = () => setStatus('starting');

    ws.onmessage = (event) => {
      let msg: KernelEvent;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'ready') {
        setStatus('idle');
        return;
      }
      if (msg.type === 'kernel_exit') {
        setStatus('disconnected');
        return;
      }

      const parentId = msg.parent_msg_id || '';

      if (msg.type === 'complete_reply') {
        const resolver = completionPendingRef.current.get(parentId);
        if (resolver) {
          completionPendingRef.current.delete(parentId);
          resolver({
            matches: (msg.matches as string[]) || [],
            cursor_start: (msg.cursor_start as number) || 0,
            cursor_end: (msg.cursor_end as number) || 0,
            metadata: (msg.metadata as CompletionResult['metadata']) || {},
          });
        }
        return;
      }

      const cellId = msgIdToCellRef.current.get(parentId);

      if (msg.type === 'status') {
        const state = msg.state as string | undefined;
        if (state === 'busy') setStatus('busy');
        else if (state === 'idle') {
          setStatus('idle');
          if (cellId && runningCellRef.current === cellId) {
            runningCellRef.current = null;
          }
        }
      }

      if (msg.type === 'execute_reply' && cellId) {
        // Clean up mapping once the reply arrives
        msgIdToCellRef.current.delete(parentId);
      }

      if (cellId) onCellEventRef.current(cellId, msg);
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setStatus('disconnected');
      if (enabled) {
        reconnectTimerRef.current = setTimeout(() => connect(), 3000);
      }
    };

    ws.onerror = () => { /* onclose handles reconnect */ };
  }, [sessionId, enabled]);

  useEffect(() => {
    if (enabled && sessionId) connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        const old = wsRef.current;
        wsRef.current = null;
        old.onclose = null; old.onerror = null; old.onmessage = null;
        old.close();
      }
    };
  }, [connect, enabled, sessionId]);

  const executeCell = useCallback((cellId: string, code: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const msgId = `cell-${cellId}-${Date.now()}`;
    msgIdToCellRef.current.set(msgId, cellId);
    runningCellRef.current = cellId;
    ws.send(JSON.stringify({ cmd: 'execute', msg_id: msgId, code }));
    return true;
  }, []);

  const requestCompletion = useCallback((code: string, cursorPos: number, timeoutMs = 1500): Promise<CompletionResult | null> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve(null);
    const msgId = `complete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        completionPendingRef.current.delete(msgId);
        resolve(null);
      }, timeoutMs);
      completionPendingRef.current.set(msgId, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      ws.send(JSON.stringify({ cmd: 'complete', msg_id: msgId, code, cursor_pos: cursorPos }));
    });
  }, []);

  const interrupt = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ cmd: 'interrupt' }));
  }, []);

  const restart = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    msgIdToCellRef.current.clear();
    runningCellRef.current = null;
    setStatus('starting');
    ws.send(JSON.stringify({ cmd: 'restart' }));
  }, []);

  return {
    status,
    runningCellId: runningCellRef.current,
    executeCell,
    requestCompletion,
    interrupt,
    restart,
  };
}
