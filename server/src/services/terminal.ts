import * as pty from 'node-pty';
import type { WebSocket } from 'ws';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SCROLLBACK_LIMIT = 256 * 1024;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

interface TerminalProcess {
  pty: pty.IPty;
  cwd: string;
  cols: number;
  rows: number;
  clients: Set<WebSocket>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  scrollback: string;
}

const processes = new Map<string, TerminalProcess>();

function key(sessionId: string, tabId: string): string {
  return `${sessionId}:${tabId}`;
}

function broadcast(tp: TerminalProcess, data: string): void {
  for (const ws of tp.clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function appendScrollback(tp: TerminalProcess, data: string): void {
  tp.scrollback += data;
  if (tp.scrollback.length > SCROLLBACK_LIMIT) {
    tp.scrollback = tp.scrollback.slice(tp.scrollback.length - SCROLLBACK_LIMIT);
  }
}

function startIdleTimer(k: string, tp: TerminalProcess): void {
  if (tp.idleTimer) clearTimeout(tp.idleTimer);
  tp.idleTimer = setTimeout(() => {
    if (tp.clients.size === 0) terminal.stop(k);
  }, IDLE_TIMEOUT_MS);
}

export const terminal = {
  start(sessionId: string, tabId: string, cwd: string): TerminalProcess {
    const k = key(sessionId, tabId);
    const existing = processes.get(k);
    if (existing) return existing;

    const shell = process.env.SHELL || '/bin/bash';
    const ptyProc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });

    const tp: TerminalProcess = {
      pty: ptyProc,
      cwd,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      clients: new Set(),
      idleTimer: null,
      scrollback: '',
    };

    ptyProc.onData((data) => {
      appendScrollback(tp, data);
      broadcast(tp, data);
    });

    ptyProc.onExit(({ exitCode }) => {
      console.log(`[terminal:${sessionId.slice(0, 8)}/${tabId.slice(0, 6)}] exit=${exitCode}`);
      for (const ws of tp.clients) {
        if (ws.readyState === 1) {
          try { ws.close(1000, 'pty exited'); } catch { /* */ }
        }
      }
      processes.delete(k);
    });

    processes.set(k, tp);
    return tp;
  },

  stop(k: string): void {
    const tp = processes.get(k);
    if (!tp) return;
    if (tp.idleTimer) clearTimeout(tp.idleTimer);
    try { tp.pty.kill(); } catch { /* */ }
    processes.delete(k);
  },

  killSession(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const k of Array.from(processes.keys())) {
      if (k.startsWith(prefix)) this.stop(k);
    }
  },

  handleWebSocket(ws: WebSocket, sessionId: string, tabId: string, cwd: string): void {
    const k = key(sessionId, tabId);
    const tp = this.start(sessionId, tabId, cwd);
    tp.clients.add(ws);
    if (tp.idleTimer) { clearTimeout(tp.idleTimer); tp.idleTimer = null; }

    if (tp.scrollback) {
      try { ws.send(tp.scrollback); } catch { /* */ }
    }

    ws.on('message', (data) => {
      const raw = data.toString();
      let msg: { type?: string; data?: string; cols?: number; rows?: number };
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'input' && typeof msg.data === 'string') {
        try { tp.pty.write(msg.data); } catch { /* */ }
      } else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
        const cols = Math.max(1, Math.floor(msg.cols));
        const rows = Math.max(1, Math.floor(msg.rows));
        if (cols !== tp.cols || rows !== tp.rows) {
          tp.cols = cols;
          tp.rows = rows;
          try { tp.pty.resize(cols, rows); } catch { /* */ }
        }
      } else if (msg.type === 'kill') {
        terminal.stop(k);
      }
    });

    const onDisconnect = () => {
      tp.clients.delete(ws);
      if (tp.clients.size === 0) startIdleTimer(k, tp);
    };
    ws.on('close', onDisconnect);
    ws.on('error', onDisconnect);
  },

  isRunning(sessionId: string, tabId: string): boolean {
    return processes.has(key(sessionId, tabId));
  },

  forceStopAll(): void {
    for (const [k, tp] of processes) {
      if (tp.idleTimer) clearTimeout(tp.idleTimer);
      try { tp.pty.kill(); } catch { /* */ }
      processes.delete(k);
    }
  },
};
