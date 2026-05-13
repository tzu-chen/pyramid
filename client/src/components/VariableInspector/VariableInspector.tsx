import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import styles from './VariableInspector.module.css';

interface Variable {
  name: string;
  type: string;
  repr: string;
  shape: string | null;
  size: number | null;
}

interface VariableInspectorProps {
  sessionId: string;
  active: boolean;
  suspended?: boolean;
}

type ConnState = 'disconnected' | 'connecting' | 'ready' | 'busy';

function formatBytes(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function VariableInspector({ sessionId, active, suspended = false }: VariableInspectorProps) {
  const [vars, setVars] = useState<Variable[]>([]);
  const [connState, setConnState] = useState<ConnState>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(() => {
    return localStorage.getItem('pyramid_var_inspector_auto') !== '0';
  });
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const pendingMsgIdRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track kernel busy state observed via broadcasts; only auto-refresh on busy→idle.
  const kernelBusyRef = useRef<boolean>(false);
  // Read auto-refresh through a ref inside the WS handler so toggling the
  // checkbox doesn't tear down the WebSocket.
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;

  const wantActive = active && !suspended;

  useEffect(() => {
    localStorage.setItem('pyramid_var_inspector_auto', autoRefresh ? '1' : '0');
  }, [autoRefresh]);

  const sendInspect = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (pendingMsgIdRef.current) return; // already inflight
    const msgId = `inspect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingMsgIdRef.current = msgId;
    setConnState('busy');
    ws.send(JSON.stringify({ cmd: 'inspect', msg_id: msgId }));
  }, []);

  // Connect WebSocket when active
  useEffect(() => {
    if (!wantActive) {
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      if (wsRef.current) {
        const old = wsRef.current;
        wsRef.current = null;
        old.onclose = null; old.onerror = null; old.onmessage = null;
        try { old.close(); } catch { /* */ }
      }
      setConnState('disconnected');
      pendingMsgIdRef.current = null;
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws/notebook/${sessionId}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setConnState('connecting');

      ws.onopen = () => {
        // Wait for `ready` before allowing inspect.
      };

      ws.onmessage = (event) => {
        let msg: { type: string; [key: string]: unknown };
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'ready') {
          setConnState('ready');
          // Initial refresh on first connect
          sendInspect();
          return;
        }

        if (msg.type === 'kernel_exit') {
          setConnState('disconnected');
          return;
        }

        if (msg.type === 'status') {
          const state = msg.state as string | undefined;
          if (state === 'busy') {
            kernelBusyRef.current = true;
          } else if (state === 'idle') {
            const wasBusy = kernelBusyRef.current;
            kernelBusyRef.current = false;
            // Auto-refresh after another cell finished (not for our own inspect).
            if (wasBusy && autoRefreshRef.current && !pendingMsgIdRef.current) {
              if (autoRefreshTimerRef.current) clearTimeout(autoRefreshTimerRef.current);
              autoRefreshTimerRef.current = setTimeout(() => sendInspect(), 250);
            }
          }
          return;
        }

        if (msg.type === 'inspect_reply') {
          const parentId = msg.parent_msg_id as string;
          if (pendingMsgIdRef.current !== parentId) return;
          pendingMsgIdRef.current = null;
          const variables = (msg.variables as Variable[]) || [];
          const error = msg.error as string | undefined;
          setVars(variables);
          setLastError(error || null);
          setLastRefresh(Date.now());
          setConnState('ready');
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        setConnState('disconnected');
        pendingMsgIdRef.current = null;
        if (!cancelled && wantActive) {
          reconnectTimerRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => { /* onclose handles reconnect */ };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      if (autoRefreshTimerRef.current) { clearTimeout(autoRefreshTimerRef.current); autoRefreshTimerRef.current = null; }
      if (wsRef.current) {
        const old = wsRef.current;
        wsRef.current = null;
        old.onclose = null; old.onerror = null; old.onmessage = null;
        try { old.close(); } catch { /* */ }
      }
    };
  }, [wantActive, sessionId, sendInspect]);

  const toggleExpanded = useCallback((name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const filtered = filter.trim()
    ? vars.filter(v => v.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : vars;

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <span className={`${styles.statusDot} ${styles[`status_${connState}`] || ''}`} />
        <span className={styles.statusLabel}>
          {connState === 'busy' ? 'Inspecting…'
            : connState === 'ready' ? 'Connected'
            : connState === 'connecting' ? 'Connecting…'
            : 'Disconnected'}
        </span>
        <div style={{ flex: 1 }} />
        <label className={styles.autoLabel} title="Refresh variables automatically after each cell run">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
          />
          Auto
        </label>
        <button
          onClick={sendInspect}
          disabled={connState !== 'ready' && connState !== 'busy'}
          title="Refresh now"
        >
          {connState === 'busy' ? '…' : 'Refresh'}
        </button>
      </div>

      <div className={styles.filterRow}>
        <input
          className={styles.filterInput}
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by name…"
        />
        <span className={styles.count}>{filtered.length}/{vars.length}</span>
      </div>

      {lastError && (
        <div className={styles.error}>{lastError}</div>
      )}

      <div className={styles.body}>
        {filtered.length === 0 ? (
          <div className={styles.placeholder}>
            {connState === 'disconnected'
              ? 'Connecting to kernel…'
              : vars.length === 0
                ? 'No user variables defined yet. Run a cell that assigns a value.'
                : 'No variables match the filter.'}
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colName}>Name</th>
                <th className={styles.colType}>Type</th>
                <th className={styles.colShape}>Shape</th>
                <th className={styles.colSize}>Size</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => {
                const isOpen = expanded.has(v.name);
                return (
                  <Fragment key={v.name}>
                    <tr
                      className={styles.row}
                      onClick={() => toggleExpanded(v.name)}
                    >
                      <td className={styles.colName}>
                        <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}>▸</span>
                        {v.name}
                      </td>
                      <td className={styles.colType}>{v.type}</td>
                      <td className={styles.colShape}>{v.shape || ''}</td>
                      <td className={styles.colSize}>{formatBytes(v.size)}</td>
                    </tr>
                    {isOpen && (
                      <tr className={styles.reprRow}>
                        <td colSpan={4}><pre className={styles.repr}>{v.repr}</pre></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {lastRefresh && (
        <div className={styles.footer}>
          Updated {new Date(lastRefresh).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

export default VariableInspector;
