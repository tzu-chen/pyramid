import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from '../../contexts/ThemeContext';
import { useTerminal } from '../../hooks/useTerminal';
import styles from './TerminalPane.module.css';

interface Tab {
  id: string;
  label: string;
}

interface PersistedState {
  tabs: Tab[];
  activeId: string | null;
}

const MAX_TABS = 8;

// crypto.randomUUID is only available in secure contexts (HTTPS / localhost).
// Prod is typically reached over LAN (e.g. http://192.168.x.x:3007) where it
// is undefined, so fall back to a Math.random ID for client-only tab keys.
function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function storageKey(sessionId: string): string {
  return `pyramid_terminals_${sessionId}`;
}

function loadState(sessionId: string): PersistedState {
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (Array.isArray(parsed.tabs) && parsed.tabs.every(t => t && typeof t.id === 'string' && typeof t.label === 'string')) {
        return {
          tabs: parsed.tabs.slice(0, MAX_TABS),
          activeId: parsed.activeId && parsed.tabs.some(t => t.id === parsed.activeId) ? parsed.activeId : (parsed.tabs[0]?.id ?? null),
        };
      }
    }
  } catch { /* */ }
  return { tabs: [], activeId: null };
}

function saveState(sessionId: string, state: PersistedState): void {
  try { localStorage.setItem(storageKey(sessionId), JSON.stringify(state)); } catch { /* */ }
}

interface TerminalPaneProps {
  sessionId: string;
  visible: boolean;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function buildTheme() {
  const bg = readCssVar('--color-bg', '#ffffff');
  const fg = readCssVar('--color-text', '#212529');
  const cursor = readCssVar('--color-primary', '#4263eb');
  const selectionBg = readCssVar('--color-primary-light', '#edf2ff');
  return {
    background: bg,
    foreground: fg,
    cursor,
    cursorAccent: bg,
    selectionBackground: selectionBg,
  };
}

interface TerminalTabProps {
  sessionId: string;
  tabId: string;
  active: boolean;
  paneVisible: boolean;
  themeKey: string;
}

function TerminalTab({ sessionId, tabId, active, paneVisible, themeKey }: TerminalTabProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [term, setTerm] = useState<Terminal | null>(null);
  const [fitAddon, setFitAddon] = useState<FitAddon | null>(null);

  // Create xterm instance once per tab (themeKey rebuilds when theme changes).
  // Deferred via rAF so StrictMode's mount → cleanup → mount cancels the first
  // attempt before any Terminal is created — avoiding a race where a disposed
  // Terminal's queued Viewport.syncScrollArea timeout dereferences a now-null
  // renderer and throws during React's commit phase.
  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    let createdTerm: Terminal | null = null;
    const raf = requestAnimationFrame(() => {
      if (cancelled || !hostRef.current) return;
      const t = new Terminal({
        cursorBlink: true,
        fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, monospace',
        fontSize: 13,
        scrollback: 5000,
        convertEol: false,
        theme: buildTheme(),
        allowProposedApi: false,
      });
      const fa = new FitAddon();
      t.loadAddon(fa);
      t.open(hostRef.current);
      try { fa.fit(); } catch { /* */ }
      createdTerm = t;
      setTerm(t);
      setFitAddon(fa);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (createdTerm) {
        try { createdTerm.dispose(); } catch { /* */ }
      }
      setTerm(null);
      setFitAddon(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey]);

  const { fit } = useTerminal({ sessionId, tabId, term, fitAddon, enabled: true });

  // Refit when this tab becomes active or the pane becomes visible/resizes
  useEffect(() => {
    if (!active || !paneVisible || !fitAddon) return;
    let raf = 0;
    const run = () => {
      try { fitAddon.fit(); fit(); } catch { /* */ }
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [active, paneVisible, fitAddon, fit]);

  // Refit on container resize
  useEffect(() => {
    if (!hostRef.current || !fitAddon) return;
    const ro = new ResizeObserver(() => {
      if (!active) return;
      try { fitAddon.fit(); fit(); } catch { /* */ }
    });
    ro.observe(hostRef.current);
    return () => ro.disconnect();
  }, [fitAddon, active, fit]);

  // Focus the terminal when it becomes active
  useEffect(() => {
    if (active && term) {
      try { term.focus(); } catch { /* */ }
    }
  }, [active, term]);

  return (
    <div
      ref={hostRef}
      className={styles.terminalHost}
      style={{ display: active ? 'block' : 'none' }}
    />
  );
}

function TerminalPane({ sessionId, visible }: TerminalPaneProps) {
  const { schemeId } = useTheme();
  const [state, setState] = useState<PersistedState>(() => loadState(sessionId));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const tabCounterRef = useRef(state.tabs.length);

  // Reload state when session changes
  useEffect(() => {
    const loaded = loadState(sessionId);
    setState(loaded);
    tabCounterRef.current = loaded.tabs.length;
  }, [sessionId]);

  // Persist state on change
  useEffect(() => {
    saveState(sessionId, state);
  }, [sessionId, state]);

  // Create the first tab automatically if none exist
  useEffect(() => {
    if (state.tabs.length === 0) {
      const id = randomId();
      tabCounterRef.current = 1;
      setState({ tabs: [{ id, label: 'Terminal 1' }], activeId: id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const openTab = useCallback(() => {
    setState(prev => {
      if (prev.tabs.length >= MAX_TABS) return prev;
      const id = randomId();
      tabCounterRef.current += 1;
      const label = `Terminal ${tabCounterRef.current}`;
      return { tabs: [...prev.tabs, { id, label }], activeId: id };
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    // Best-effort: send a kill to the pty by opening a transient ws.
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal/${sessionId}/${id}`);
      ws.onopen = () => {
        try { ws.send(JSON.stringify({ type: 'kill' })); } catch { /* */ }
        try { ws.close(); } catch { /* */ }
      };
      // If never opens, browser GC closes it.
    } catch { /* */ }

    setState(prev => {
      const tabs = prev.tabs.filter(t => t.id !== id);
      let activeId = prev.activeId;
      if (activeId === id) {
        activeId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
      }
      return { tabs, activeId };
    });
  }, [sessionId]);

  const startRename = useCallback((id: string, current: string) => {
    setRenaming(id);
    setRenameValue(current);
  }, []);

  const commitRename = useCallback(() => {
    if (!renaming) return;
    const trimmed = renameValue.trim();
    setState(prev => ({
      ...prev,
      tabs: prev.tabs.map(t => t.id === renaming ? { ...t, label: trimmed || t.label } : t),
    }));
    setRenaming(null);
    setRenameValue('');
  }, [renaming, renameValue]);

  const cancelRename = useCallback(() => {
    setRenaming(null);
    setRenameValue('');
  }, []);

  const themeKey = useMemo(() => schemeId, [schemeId]);

  return (
    <div className={styles.pane}>
      <div className={styles.tabBar}>
        {state.tabs.map(tab => {
          const isActive = state.activeId === tab.id;
          const isRenaming = renaming === tab.id;
          return (
            <div
              key={tab.id}
              className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
              onClick={() => !isRenaming && setState(prev => ({ ...prev, activeId: tab.id }))}
            >
              {isRenaming ? (
                <input
                  className={styles.renameInput}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename();
                    else if (e.key === 'Escape') cancelRename();
                  }}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span
                  className={styles.tabLabel}
                  onDoubleClick={(e) => { e.stopPropagation(); startRename(tab.id, tab.label); }}
                  title="Double-click to rename"
                >
                  {tab.label}
                </span>
              )}
              <button
                className={styles.tabClose}
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                title="Close terminal"
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          className={styles.newTabBtn}
          onClick={openTab}
          disabled={state.tabs.length >= MAX_TABS}
          title={state.tabs.length >= MAX_TABS ? `Max ${MAX_TABS} terminals` : 'New terminal'}
        >
          +
        </button>
      </div>

      <div className={styles.body}>
        {state.tabs.length === 0 ? (
          <div className={styles.empty}>No terminal. Click + to open one.</div>
        ) : (
          state.tabs.map(tab => (
            <TerminalTab
              key={`${tab.id}:${themeKey}`}
              sessionId={sessionId}
              tabId={tab.id}
              active={state.activeId === tab.id}
              paneVisible={visible}
              themeKey={themeKey}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default TerminalPane;
