import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeEditor, { ExternalCompletionSource } from '../CodeEditor/CodeEditor';
import MarkdownRenderer from '../MarkdownRenderer/MarkdownRenderer';
import { useNotebookKernel, KernelStatus, CellOutput } from '../../hooks/useNotebookKernel';
import { useDebounce } from '../../hooks/useDebounce';
import { fileService } from '../../services/fileService';
import { editorStorage } from '../../services/editorStorage';
import { formatBytes } from '../../utils/format';
import styles from './NotebookEditor.module.css';

type CellType = 'code' | 'markdown';
type RunState = 'none' | 'ok' | 'modified' | 'error';

interface NotebookCell {
  id: string;
  cell_type: CellType;
  source: string;
  outputs: CellOutput[];
  execution_count: number | null;
  metadata?: Record<string, unknown>;
}

interface Notebook {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

interface NotebookEditorProps {
  sessionId: string;
  fileId: string;
  fontSize: number;
  suspended?: boolean;
}

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function emptyNotebook(): Notebook {
  return {
    cells: [{ id: newId(), cell_type: 'code', source: '', outputs: [], execution_count: null }],
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

function normalizeSource(src: string | string[]): string {
  return Array.isArray(src) ? src.join('') : (src || '');
}

function parseNotebook(content: string): Notebook {
  if (!content.trim()) return emptyNotebook();
  try {
    const parsed = JSON.parse(content);
    const cells: NotebookCell[] = (parsed.cells || []).map((c: Record<string, unknown>) => ({
      id: (c.id as string) || newId(),
      cell_type: (c.cell_type as CellType) || 'code',
      source: normalizeSource(c.source as string | string[]),
      outputs: ((c.outputs as CellOutput[]) || []),
      execution_count: (c.execution_count as number | null) ?? null,
      metadata: (c.metadata as Record<string, unknown>) || {},
    }));
    return {
      cells: cells.length ? cells : emptyNotebook().cells,
      metadata: parsed.metadata || {},
      nbformat: parsed.nbformat || 4,
      nbformat_minor: parsed.nbformat_minor || 5,
    };
  } catch {
    return emptyNotebook();
  }
}

function serializeNotebook(nb: Notebook): string {
  const out = {
    ...nb,
    cells: nb.cells.map(c => ({
      cell_type: c.cell_type,
      id: c.id,
      metadata: c.metadata || {},
      source: c.source,
      ...(c.cell_type === 'code'
        ? { outputs: c.outputs, execution_count: c.execution_count }
        : {}),
    })),
  };
  return JSON.stringify(out, null, 1);
}

function statusLabel(status: KernelStatus): string {
  switch (status) {
    case 'idle': return 'Kernel idle';
    case 'busy': return 'Running...';
    case 'starting': return 'Starting kernel...';
    case 'connecting': return 'Connecting...';
    case 'disconnected': return 'Disconnected';
  }
}

function statusDotClass(status: KernelStatus): string {
  switch (status) {
    case 'idle': return styles.statusIdle;
    case 'busy': return styles.statusBusy;
    case 'starting':
    case 'connecting': return styles.statusStarting;
    case 'disconnected': return styles.statusDisconnected;
  }
}

// Indicator-light for a code cell's top-left corner.
function runStateClass(state: RunState): string {
  switch (state) {
    case 'ok': return styles.runIndicatorOk;
    case 'modified': return styles.runIndicatorModified;
    case 'error': return styles.runIndicatorError;
    case 'none': return styles.runIndicatorNone;
  }
}

function runStateTitle(state: RunState): string {
  switch (state) {
    case 'ok': return 'Run — output is up to date';
    case 'modified': return 'Edited since last run';
    case 'error': return 'Last run raised an error';
    case 'none': return 'Not run yet';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 2 : 1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec - min * 60);
  return `${min}m ${remSec}s`;
}

function useTick(active: boolean, intervalMs: number): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => force(t => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}

// Match a markdown heading on the first non-empty line of a cell's source.
// Returns 0 if the cell is not a heading.
function getHeadingLevel(cell: NotebookCell): number {
  if (cell.cell_type !== 'markdown') return 0;
  const src = cell.source || '';
  // Find first non-empty line
  for (const rawLine of src.split('\n')) {
    const line = rawLine.trimStart();
    if (!line) continue;
    const m = /^(#{1,6})\s+\S/.exec(line);
    return m ? m[1].length : 0;
  }
  return 0;
}


function NotebookEditor({ sessionId, fileId, fontSize, suspended = false }: NotebookEditorProps) {
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [loadedFileId, setLoadedFileId] = useState<string | null>(null);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  // Which markdown cell (if any) is currently in edit mode. Lifted out of
  // CellView so command-mode keys (Enter to edit) can drive it.
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [showLineNumbers, setShowLineNumbers] = useState(() => editorStorage.getNotebookLineNumbers());
  const [showCellNumbers, setShowCellNumbers] = useState(() => editorStorage.getNotebookCellNumbers());
  const [showCellHeaders, setShowCellHeaders] = useState(() => editorStorage.getNotebookCellHeaders());
  const notebookDataRef = useRef<Notebook | null>(null);
  notebookDataRef.current = notebook;
  const notebookRef = useRef<HTMLDivElement>(null);
  const lastDPressRef = useRef<number>(0);
  // Cell to focus its editor after the next render (edit mode lands here).
  const pendingFocusRef = useRef<string | null>(null);
  // Bumped whenever pendingFocusRef is set, so the focus effect fires even when
  // advancing to an existing cell leaves the notebook object unchanged.
  const [focusNonce, setFocusNonce] = useState(0);
  // Cell to select + scroll into view after the next render (stays in command
  // mode — used when inserting via a/b so the new cell is visibly focused).
  const pendingSelectRef = useRef<string | null>(null);

  // Load notebook from disk when fileId changes
  useEffect(() => {
    let cancelled = false;
    fileService.getContent(sessionId, fileId).then(content => {
      if (cancelled) return;
      const parsed = parseNotebook(content);
      setNotebook(parsed);
      setLoadedFileId(fileId);
      setActiveCellId(parsed.cells[0]?.id || null);
      setEditingCellId(null);
    }).catch(() => {
      if (!cancelled) {
        setNotebook(emptyNotebook());
        setLoadedFileId(fileId);
      }
    });
    return () => { cancelled = true; };
  }, [sessionId, fileId]);

  // Autosave (debounced)
  const serialized = useMemo(() => notebook ? serializeNotebook(notebook) : '', [notebook]);
  const debouncedSerialized = useDebounce(serialized, 1000);
  const lastSavedRef = useRef<string>('');
  useEffect(() => {
    if (!notebook || loadedFileId !== fileId) return;
    if (!debouncedSerialized) return;
    if (debouncedSerialized === lastSavedRef.current) return;
    lastSavedRef.current = debouncedSerialized;
    fileService.updateContent(sessionId, fileId, debouncedSerialized).catch(() => {});
  }, [debouncedSerialized, sessionId, fileId, loadedFileId, notebook]);

  // Handle kernel events — append outputs to the right cell
  const handleCellEvent = useCallback((cellId: string, event: { type: string; [key: string]: unknown }) => {
    setNotebook(prev => {
      if (!prev) return prev;
      const idx = prev.cells.findIndex(c => c.id === cellId);
      if (idx === -1) return prev;
      const cell = prev.cells[idx];
      let newOutputs = cell.outputs;
      let newCount = cell.execution_count;
      let newMetadata: Record<string, unknown> | undefined;

      switch (event.type) {
        case 'stream': {
          const name = event.name as 'stdout' | 'stderr';
          const text = event.text as string;
          // merge with last stream of same name
          const last = newOutputs[newOutputs.length - 1];
          if (last && last.output_type === 'stream' && last.name === name) {
            newOutputs = [...newOutputs.slice(0, -1), { ...last, text: (last.text || '') + text }];
          } else {
            newOutputs = [...newOutputs, { output_type: 'stream', name, text }];
          }
          break;
        }
        case 'execute_result':
          newOutputs = [...newOutputs, {
            output_type: 'execute_result',
            data: event.data as Record<string, string>,
            execution_count: event.execution_count as number,
          }];
          newCount = event.execution_count as number;
          break;
        case 'display_data':
          newOutputs = [...newOutputs, {
            output_type: 'display_data',
            data: event.data as Record<string, string>,
          }];
          break;
        case 'error':
          newOutputs = [...newOutputs, {
            output_type: 'error',
            ename: event.ename as string,
            evalue: event.evalue as string,
            traceback: event.traceback as string[],
          }];
          break;
        case 'clear_output':
          newOutputs = [];
          break;
        case 'execute_reply': {
          if (typeof event.execution_count === 'number') newCount = event.execution_count;
          const meta = (cell.metadata || {}) as Record<string, unknown>;
          const startedAt = typeof meta.run_started_at === 'number' ? meta.run_started_at : undefined;
          const { run_started_at: _started, ...rest } = meta;
          void _started;
          const updated: Record<string, unknown> = { ...rest };
          // Authoritative pass/fail for this run. The iopub `error` output can be
          // dropped if execute_reply races ahead of it, so the indicator light
          // keys off this rather than scanning outputs.
          updated.last_run_status = event.status === 'error' ? 'error' : 'ok';
          if (startedAt !== undefined) {
            updated.last_duration_ms = Math.max(0, Date.now() - startedAt);
          }
          // Peak kernel RSS and per-cell delta from jupyter-bridge (null when
          // the host can't sample, e.g. non-Linux).
          updated.last_peak_rss = typeof event.peak_rss === 'number' ? event.peak_rss : null;
          updated.last_rss_delta = typeof event.rss_delta === 'number' ? event.rss_delta : null;
          newMetadata = updated;
          break;
        }
        default:
          return prev;
      }

      const newCells = [...prev.cells];
      newCells[idx] = {
        ...cell,
        outputs: newOutputs,
        execution_count: newCount,
        ...(newMetadata !== undefined ? { metadata: newMetadata } : {}),
      };
      return { ...prev, cells: newCells };
    });
  }, []);

  const kernel = useNotebookKernel({
    sessionId,
    enabled: !suspended,
    onCellEvent: handleCellEvent,
  });

  const jupyterTypeMap: Record<string, string> = {
    function: 'function', instance: 'variable', class: 'class',
    module: 'namespace', keyword: 'keyword', statement: 'text',
    path: 'text', magic: 'keyword',
  };
  const completionSource: ExternalCompletionSource = useCallback(async (code, cursorPos) => {
    const result = await kernel.requestCompletion(code, cursorPos);
    if (!result) return null;
    const typeMeta = result.metadata?._jupyter_types_experimental || [];
    return {
      from: result.cursor_start,
      to: result.cursor_end,
      matches: result.matches.map((label, i) => ({
        label,
        type: jupyterTypeMap[typeMeta[i]?.type || ''] || 'variable',
        detail: typeMeta[i]?.signature,
      })),
    };
  }, [kernel]);

  const runCell = useCallback((cellId: string) => {
    const nb = notebookDataRef.current;
    if (!nb) return;
    const cell = nb.cells.find(c => c.id === cellId);
    if (!cell || cell.cell_type !== 'code') return;
    const sourceAtRun = cell.source;
    const startedAt = Date.now();
    // clear outputs for this cell then send; record source so we can detect edits since last run
    setNotebook(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        cells: prev.cells.map(c => c.id === cellId
          ? {
              ...c,
              outputs: [],
              execution_count: null,
              metadata: {
                ...(c.metadata || {}),
                last_run_source: sourceAtRun,
                run_started_at: startedAt,
                last_run_status: undefined,
                last_duration_ms: undefined,
                last_peak_rss: undefined,
                last_rss_delta: undefined,
              },
            }
          : c),
      };
    });
    kernel.executeCell(cellId, sourceAtRun);
  }, [kernel]);

  const toggleLineNumbers = useCallback(() => {
    setShowLineNumbers(prev => {
      const next = !prev;
      editorStorage.saveNotebookLineNumbers(next);
      return next;
    });
  }, []);

  const toggleCellNumbers = useCallback(() => {
    setShowCellNumbers(prev => {
      const next = !prev;
      editorStorage.saveNotebookCellNumbers(next);
      return next;
    });
  }, []);

  const toggleCellHeaders = useCallback(() => {
    setShowCellHeaders(prev => {
      const next = !prev;
      editorStorage.saveNotebookCellHeaders(next);
      return next;
    });
  }, []);

  const runAll = useCallback(() => {
    const nb = notebookDataRef.current;
    if (!nb) return;
    for (const c of nb.cells) {
      if (c.cell_type === 'code' && c.source.trim()) runCell(c.id);
    }
  }, [runCell]);

  const updateCellSource = useCallback((cellId: string, source: string) => {
    setNotebook(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        cells: prev.cells.map(c => c.id === cellId ? { ...c, source } : c),
      };
    });
  }, []);

  const insertCellAt = useCallback((index: number, type: CellType) => {
    const newCell: NotebookCell = { id: newId(), cell_type: type, source: '', outputs: [], execution_count: null };
    setNotebook(prev => {
      if (!prev) return prev;
      const next = [...prev.cells];
      next.splice(index, 0, newCell);
      return { ...prev, cells: next };
    });
    // Land on the new cell in command mode and scroll it into view, so a/b
    // always visibly focus the cell they just created.
    setActiveCellId(newCell.id);
    setEditingCellId(null);
    pendingSelectRef.current = newCell.id;
  }, []);

  // Put a markdown cell into edit mode (and select it). For code cells edit
  // mode is just editor focus, handled via focusActiveCellEditor.
  const startEditCell = useCallback((cellId: string) => {
    setActiveCellId(cellId);
    setEditingCellId(cellId);
    // Focus the markdown textarea once it mounts (in addition to its autoFocus).
    pendingFocusRef.current = cellId;
    setFocusNonce(n => n + 1);
  }, []);

  const stopEditCell = useCallback((cellId: string) => {
    setEditingCellId(prev => (prev === cellId ? null : prev));
  }, []);

  const deleteCell = useCallback((cellId: string) => {
    setEditingCellId(prev => (prev === cellId ? null : prev));
    setNotebook(prev => {
      if (!prev) return prev;
      const next = prev.cells.filter(c => c.id !== cellId);
      return { ...prev, cells: next.length ? next : emptyNotebook().cells };
    });
  }, []);

  const moveCell = useCallback((cellId: string, dir: -1 | 1) => {
    setNotebook(prev => {
      if (!prev) return prev;
      const idx = prev.cells.findIndex(c => c.id === cellId);
      const target = idx + dir;
      if (idx === -1 || target < 0 || target >= prev.cells.length) return prev;
      const next = [...prev.cells];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, cells: next };
    });
  }, []);

  const changeCellType = useCallback((cellId: string, type: CellType) => {
    setNotebook(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        cells: prev.cells.map(c => c.id === cellId ? { ...c, cell_type: type, outputs: [], execution_count: null } : c),
      };
    });
  }, []);

  const toggleOutputsCollapsed = useCallback((cellId: string) => {
    setNotebook(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        cells: prev.cells.map(c => {
          if (c.id !== cellId) return c;
          const meta = (c.metadata || {}) as Record<string, unknown>;
          return { ...c, metadata: { ...meta, collapsed: !meta.collapsed } };
        }),
      };
    });
  }, []);

  const toggleCellHalfWidth = useCallback((cellId: string) => {
    setNotebook(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        cells: prev.cells.map(c => {
          if (c.id !== cellId) return c;
          const meta = (c.metadata || {}) as Record<string, unknown>;
          return { ...c, metadata: { ...meta, half_width: !meta.half_width } };
        }),
      };
    });
  }, []);

  const toggleSectionCollapsed = useCallback((cellId: string) => {
    setNotebook(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        cells: prev.cells.map(c => {
          if (c.id !== cellId) return c;
          const meta = (c.metadata || {}) as Record<string, unknown>;
          return { ...c, metadata: { ...meta, section_collapsed: !meta.section_collapsed } };
        }),
      };
    });
  }, []);

  // Focus a cell's editor (CodeMirror for code, textarea for editing markdown).
  // Returns false when the cell has no editor to focus (e.g. rendered markdown),
  // so callers can fall back to command-mode (root) focus.
  const focusActiveCellEditor = useCallback((cellId: string): boolean => {
    const root = notebookRef.current;
    if (!root) return false;
    const cellEl = root.querySelector(`[data-cell-id="${cellId}"]`);
    if (!cellEl) return false;
    const cm = cellEl.querySelector<HTMLElement>('.cm-content');
    if (cm) { cm.focus(); return true; }
    const ta = cellEl.querySelector<HTMLTextAreaElement>('textarea');
    if (ta) { ta.focus(); return true; }
    return false;
  }, []);

  const advanceFromCell = useCallback((cellId: string) => {
    const nb = notebookDataRef.current;
    if (!nb) return;
    const idx = nb.cells.findIndex(c => c.id === cellId);
    if (idx === -1) return;
    setEditingCellId(null);
    if (idx + 1 < nb.cells.length) {
      const nextId = nb.cells[idx + 1].id;
      setActiveCellId(nextId);
      pendingFocusRef.current = nextId;
      setFocusNonce(n => n + 1);
      return;
    }
    // Past the end — append a fresh code cell and land in it.
    const newCell: NotebookCell = { id: newId(), cell_type: 'code', source: '', outputs: [], execution_count: null };
    setActiveCellId(newCell.id);
    pendingFocusRef.current = newCell.id;
    setFocusNonce(n => n + 1);
    setNotebook(prev => (prev ? { ...prev, cells: [...prev.cells, newCell] } : prev));
  }, []);

  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    pendingFocusRef.current = null;
    requestAnimationFrame(() => {
      // If the target cell has no editor (rendered markdown), fall back to
      // command-mode focus on the notebook root so navigation keeps working.
      if (!focusActiveCellEditor(id)) notebookRef.current?.focus({ preventScroll: true });
    });
  }, [notebook, focusNonce, focusActiveCellEditor]);

  // Select + scroll-to a cell without entering edit mode (a/b inserts).
  useEffect(() => {
    const id = pendingSelectRef.current;
    if (!id) return;
    pendingSelectRef.current = null;
    requestAnimationFrame(() => {
      const root = notebookRef.current;
      root?.querySelector(`[data-cell-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      root?.focus({ preventScroll: true });
    });
  }, [notebook]);

  // Compute which cells are hidden by collapsed markdown-heading sections.
  // A section starts at a heading cell with level N and contains all subsequent
  // cells until the next heading of level ≤ N. Collapsing that heading hides
  // everything inside, including nested sub-headings.
  const { hiddenCells, sectionHiddenCount } = useMemo(() => {
    const hidden = new Set<string>();
    const counts = new Map<string, number>();
    if (!notebook) return { hiddenCells: hidden, sectionHiddenCount: counts };
    type StackEntry = { level: number; collapsed: boolean; headingCellId: string };
    const stack: StackEntry[] = [];
    for (const c of notebook.cells) {
      const level = getHeadingLevel(c);
      const isCollapsedHeading =
        level > 0 && !!(c.metadata as Record<string, unknown> | undefined)?.section_collapsed;
      if (level > 0) {
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      }
      const anyCollapsed = stack.some(s => s.collapsed);
      if (anyCollapsed) {
        hidden.add(c.id);
        const outermost = stack.find(s => s.collapsed);
        if (outermost) counts.set(outermost.headingCellId, (counts.get(outermost.headingCellId) || 0) + 1);
      }
      if (level > 0) {
        stack.push({ level, collapsed: isCollapsedHeading || anyCollapsed, headingCellId: c.id });
      }
    }
    return { hiddenCells: hidden, sectionHiddenCount: counts };
  }, [notebook]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const inEditor = !!target.closest('.cm-editor') || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT';

    if (e.key === 'Escape' && inEditor) {
      e.preventDefault();
      (target as HTMLElement).blur?.();
      notebookRef.current?.focus();
      return;
    }
    if (inEditor) return;

    const nb = notebookDataRef.current;
    if (!nb || !activeCellId) return;
    const idx = nb.cells.findIndex(c => c.id === activeCellId);
    if (idx === -1) return;

    if (e.key !== 'd') lastDPressRef.current = 0;

    switch (e.key) {
      case 'a':
        e.preventDefault();
        insertCellAt(idx, 'code');
        break;
      case 'b':
        e.preventDefault();
        insertCellAt(idx + 1, 'code');
        break;
      case 'm':
        e.preventDefault();
        changeCellType(activeCellId, 'markdown');
        break;
      case 'y':
        e.preventDefault();
        changeCellType(activeCellId, 'code');
        break;
      case 'j':
      case 'ArrowDown': {
        let next = idx + 1;
        while (next < nb.cells.length && hiddenCells.has(nb.cells[next].id)) next++;
        if (next < nb.cells.length) {
          e.preventDefault();
          setActiveCellId(nb.cells[next].id);
        }
        break;
      }
      case 'k':
      case 'ArrowUp': {
        let prev = idx - 1;
        while (prev >= 0 && hiddenCells.has(nb.cells[prev].id)) prev--;
        if (prev >= 0) {
          e.preventDefault();
          setActiveCellId(nb.cells[prev].id);
        }
        break;
      }
      case 'Enter': {
        const cell = nb.cells[idx];
        if (e.shiftKey) {
          // Run (if code) and always advance to the next cell — same behavior
          // from command mode whether the current cell is code or markdown.
          e.preventDefault();
          if (cell.cell_type === 'code') runCell(cell.id);
          advanceFromCell(cell.id);
        } else if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          // Enter the focused cell's edit mode. Markdown needs its editor
          // mounted (it renders by default), so flip editing state for it.
          if (cell.cell_type === 'markdown') {
            startEditCell(cell.id);
          } else {
            focusActiveCellEditor(cell.id);
          }
        }
        break;
      }
      case 'd': {
        const now = Date.now();
        if (lastDPressRef.current && now - lastDPressRef.current < 600) {
          e.preventDefault();
          const nextActive = nb.cells[idx + 1]?.id ?? nb.cells[idx - 1]?.id ?? null;
          deleteCell(activeCellId);
          if (nextActive) setActiveCellId(nextActive);
          lastDPressRef.current = 0;
        } else {
          lastDPressRef.current = now;
        }
        break;
      }
    }
  }, [activeCellId, insertCellAt, changeCellType, deleteCell, focusActiveCellEditor, hiddenCells, runCell, advanceFromCell, startEditCell]);

  if (!notebook) {
    return <div className={styles.notebook}><div className={styles.toolbar}>Loading notebook...</div></div>;
  }

  return (
    <div
      className={styles.notebook}
      ref={notebookRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.toolbar}>
        <span className={`${styles.statusDot} ${statusDotClass(kernel.status)}`} />
        <span className={styles.statusLabel}>{statusLabel(kernel.status)}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={toggleLineNumbers}
          className={showLineNumbers ? styles.toggleActive : ''}
          title={showLineNumbers ? 'Hide line numbers in all cells' : 'Show line numbers in all cells'}
        >
          # Lines
        </button>
        <button
          onClick={toggleCellHeaders}
          className={showCellHeaders ? styles.toggleActive : ''}
          title={showCellHeaders ? 'Hide cell headers (type / timing / actions strip)' : 'Show cell headers (type / timing / actions strip)'}
        >
          Headers
        </button>
        <button
          onClick={toggleCellNumbers}
          className={showCellNumbers ? styles.toggleActive : ''}
          title={showCellNumbers ? 'Hide cell numbers' : 'Show cell numbers'}
        >
          # Cells
        </button>
        <button onClick={runAll} disabled={kernel.status !== 'idle' && kernel.status !== 'busy'}>Run All</button>
        <button onClick={kernel.interrupt} disabled={kernel.status !== 'busy'}>Interrupt</button>
        <button onClick={kernel.restart} disabled={kernel.status === 'disconnected' || kernel.status === 'connecting'}>Restart</button>
      </div>

      <div className={styles.cellList}>
        {notebook.cells.map((cell) => {
          if (hiddenCells.has(cell.id)) return null;
          const headingLevel = getHeadingLevel(cell);
          const sectionCollapsed = headingLevel > 0
            && !!(cell.metadata as Record<string, unknown> | undefined)?.section_collapsed;
          const hiddenInSection = sectionCollapsed ? (sectionHiddenCount.get(cell.id) || 0) : 0;
          const halfWidth = !!(cell.metadata as Record<string, unknown> | undefined)?.half_width;
          return (
            <CellView
              key={cell.id}
              cell={cell}
              showCellNumber={showCellNumbers}
              showLineNumbers={showLineNumbers}
              showHeader={showCellHeaders}
              active={cell.id === activeCellId}
              editing={cell.id === editingCellId}
              running={kernel.runningCellId === cell.id}
              kernelIdle={kernel.status === 'idle' || kernel.status === 'busy'}
              fontSize={fontSize}
              headingLevel={headingLevel}
              sectionCollapsed={sectionCollapsed}
              hiddenInSection={hiddenInSection}
              halfWidth={halfWidth}
              onFocus={() => setActiveCellId(cell.id)}
              onStartEdit={() => startEditCell(cell.id)}
              onStopEdit={() => stopEditCell(cell.id)}
              onChange={(src) => updateCellSource(cell.id, src)}
              onRun={() => runCell(cell.id)}
              onAdvance={() => advanceFromCell(cell.id)}
              onDelete={() => deleteCell(cell.id)}
              onMoveUp={() => moveCell(cell.id, -1)}
              onMoveDown={() => moveCell(cell.id, 1)}
              onChangeType={(type) => changeCellType(cell.id, type)}
              onToggleOutputs={() => toggleOutputsCollapsed(cell.id)}
              onToggleSection={headingLevel > 0 ? () => toggleSectionCollapsed(cell.id) : undefined}
              onToggleHalfWidth={() => toggleCellHalfWidth(cell.id)}
              completionSource={completionSource}
            />
          );
        })}
      </div>
    </div>
  );
}

interface CellViewProps {
  cell: NotebookCell;
  showCellNumber: boolean;
  showLineNumbers: boolean;
  showHeader: boolean;
  active: boolean;
  editing: boolean;
  running: boolean;
  kernelIdle: boolean;
  fontSize: number;
  headingLevel: number;
  sectionCollapsed: boolean;
  hiddenInSection: number;
  halfWidth: boolean;
  onFocus: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onChange: (src: string) => void;
  onRun: () => void;
  onAdvance: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeType: (type: CellType) => void;
  onToggleOutputs: () => void;
  onToggleSection?: () => void;
  onToggleHalfWidth: () => void;
  completionSource?: ExternalCompletionSource;
}

function CellView(props: CellViewProps) {
  const { cell, showCellNumber, showLineNumbers, showHeader, active, editing, running, kernelIdle, fontSize, headingLevel, sectionCollapsed, hiddenInSection, halfWidth, onFocus, onStartEdit, onStopEdit, onChange, onRun, onAdvance, onDelete, onMoveUp, onMoveDown, onChangeType, onToggleOutputs, onToggleSection, onToggleHalfWidth, completionSource } = props;
  const meta = (cell.metadata || {}) as Record<string, unknown>;
  const outputsCollapsed = !!meta.collapsed;
  const lastRunSource = typeof meta.last_run_source === 'string' ? meta.last_run_source : undefined;
  const hasBeenRun = lastRunSource !== undefined;
  // Prefer the authoritative execute_reply status; fall back to scanning
  // outputs for notebooks saved before that field existed.
  const hasError = meta.last_run_status === 'error'
    || cell.outputs.some(o => o.output_type === 'error');
  // Indicator-light state shown in the cell's top-left corner:
  //   ok = run and source unchanged, modified = edited since last run,
  //   error = last run raised, none = never run (or currently running).
  // A pending edit (modified) takes precedence over a stale error.
  const runState: RunState =
    cell.cell_type !== 'code' || running || !hasBeenRun
      ? 'none'
      : lastRunSource !== cell.source
        ? 'modified'
        : hasError
          ? 'error'
          : 'ok';

  const executionMark = cell.cell_type === 'code'
    ? (running ? '[*]' : cell.execution_count != null ? `[${cell.execution_count}]` : '[ ]')
    : '';

  const runStartedAt = typeof meta.run_started_at === 'number' ? meta.run_started_at : undefined;
  const lastDurationMs = typeof meta.last_duration_ms === 'number' ? meta.last_duration_ms : undefined;
  // Tick once per second while running so the live elapsed time updates.
  useTick(running && runStartedAt !== undefined, 1000);
  const timingLabel: string | null = cell.cell_type === 'code'
    ? running && runStartedAt !== undefined
      ? formatDuration(Date.now() - runStartedAt)
      : lastDurationMs !== undefined
        ? formatDuration(lastDurationMs)
        : null
    : null;

  // Peak kernel RSS for the last run of this cell (and the per-cell delta,
  // shown in the tooltip). Hidden while running and when unavailable.
  const peakRss = typeof meta.last_peak_rss === 'number' ? meta.last_peak_rss : undefined;
  const rssDelta = typeof meta.last_rss_delta === 'number' ? meta.last_rss_delta : undefined;
  const memoryLabel: string | null =
    cell.cell_type === 'code' && !running && peakRss !== undefined
      ? formatBytes(peakRss)
      : null;
  const memoryTitle = rssDelta !== undefined
    ? `Peak kernel memory (RSS); ${rssDelta >= 0 ? '+' : ''}${formatBytes(rssDelta)} during this cell`
    : 'Peak kernel memory (RSS) during this cell';

  return (
    <div className={`${styles.cellWrapper} ${halfWidth ? styles.cellWrapperHalf : ''}`}>
      <div
        className={`${styles.cell} ${active ? styles.cellActive : ''} ${headingLevel > 0 ? styles[`headingLevel${headingLevel}`] : ''}`}
        data-cell-id={cell.id}
        onClick={onFocus}
      >
        {showHeader && (
        <div className={styles.cellHeader}>
          {headingLevel > 0 && onToggleSection && (
            <button
              className={styles.sectionToggle}
              onClick={(e) => { e.stopPropagation(); onToggleSection(); }}
              title={sectionCollapsed ? 'Expand section' : 'Collapse section'}
            >
              <span className={`${styles.sectionChevron} ${sectionCollapsed ? styles.sectionChevronCollapsed : ''}`}>▼</span>
            </button>
          )}
          {cell.cell_type === 'code' && (
            <span
              className={`${styles.runIndicator} ${runStateClass(runState)}`}
              title={runStateTitle(runState)}
            />
          )}
          <span className={styles.cellLabel}>
            {headingLevel > 0 ? `H${headingLevel}` : cell.cell_type}
          </span>
          {sectionCollapsed && hiddenInSection > 0 && (
            <span className={styles.sectionCount}>· {hiddenInSection} cell{hiddenInSection === 1 ? '' : 's'} hidden</span>
          )}
          {timingLabel && (
            <span
              className={`${styles.cellTiming} ${running ? styles.cellTimingRunning : ''}`}
              title={running ? 'Currently running' : 'Last run duration'}
            >
              {running ? `▶ ${timingLabel}` : timingLabel}
            </span>
          )}
          {memoryLabel && (
            <span className={styles.cellMemory} title={memoryTitle}>
              {memoryLabel}
            </span>
          )}
          <div className={styles.cellActions}>
            {cell.cell_type === 'code' && (
              <button onClick={(e) => { e.stopPropagation(); onRun(); }} disabled={!kernelIdle || running} title="Run cell (Shift+Enter)">Run</button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onToggleHalfWidth(); }}
              className={halfWidth ? styles.cellActionActive : ''}
              title={halfWidth ? 'Switch this cell back to full width' : 'Make this cell half width (flows side-by-side with adjacent half-width cells)'}
            >
              {halfWidth ? '◧' : '▭'}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onChangeType(cell.cell_type === 'code' ? 'markdown' : 'code'); }}>
              {cell.cell_type === 'code' ? '→ md' : '→ code'}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} title="Move up">↑</button>
            <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} title="Move down">↓</button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete cell">×</button>
          </div>
        </div>
        )}
        <div className={styles.cellBody}>
          {cell.cell_type === 'code' && showCellNumber && (
            <div className={styles.executionGutter}>{executionMark}</div>
          )}
          <div className={styles.cellContent}>
            {cell.cell_type === 'code' ? (
              <div
                className={styles.codeArea}
                onKeyDownCapture={(e) => {
                  if (e.shiftKey && e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    onRun();
                    onAdvance();
                  }
                }}
              >
                <CodeEditor
                  value={cell.source}
                  language="python"
                  onChange={onChange}
                  fontSize={fontSize}
                  externalCompletion={completionSource}
                  showLineNumbers={showLineNumbers}
                  hideSearchBar
                />
              </div>
            ) : editing ? (
              <textarea
                className={styles.markdownTextarea}
                value={cell.source}
                onChange={(e) => onChange(e.target.value)}
                onBlur={onStopEdit}
                onKeyDown={(e) => {
                  if (e.shiftKey && e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    onStopEdit();
                    onAdvance();
                  }
                }}
                placeholder="Markdown (supports LaTeX with $...$ and $$...$$)..."
                autoFocus
              />
            ) : (
              <div className={styles.markdownArea} onClick={(e) => { e.stopPropagation(); onStartEdit(); }}>
                {cell.source.trim()
                  ? <MarkdownRenderer content={cell.source} />
                  : <span className={styles.markdownPlaceholder}>Click to edit markdown...</span>}
              </div>
            )}
            {cell.cell_type === 'code' && cell.outputs.length > 0 && (
              <>
                <div
                  className={styles.outputsHeader}
                  onClick={(e) => { e.stopPropagation(); onToggleOutputs(); }}
                  title={outputsCollapsed ? 'Expand output' : 'Collapse output'}
                >
                  <span className={`${styles.outputsChevron} ${outputsCollapsed ? styles.outputsChevronCollapsed : ''}`}>▼</span>
                  <span className={styles.outputsCount}>
                    {cell.outputs.length} output{cell.outputs.length === 1 ? '' : 's'}
                  </span>
                </div>
                {!outputsCollapsed && (
                  <div className={styles.outputs}>
                    {cell.outputs.map((out, i) => <OutputView key={i} output={out} />)}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutputView({ output }: { output: CellOutput }) {
  if (output.output_type === 'stream') {
    return (
      <pre className={`${styles.stream} ${output.name === 'stderr' ? styles.stderr : styles.stdout}`}>
        {output.text}
      </pre>
    );
  }
  if (output.output_type === 'error') {
    const tb = (output.traceback || []).join('\n');
    // Strip ANSI escape codes for readable display
    const clean = tb.replace(/\x1b\[[0-9;]*m/g, '');
    return <pre className={styles.error}>{clean || `${output.ename}: ${output.evalue}`}</pre>;
  }
  if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
    const data = output.data || {};
    if (data['image/png']) {
      return <img className={styles.resultImage} src={`data:image/png;base64,${data['image/png']}`} alt="output" />;
    }
    if (data['image/jpeg']) {
      return <img className={styles.resultImage} src={`data:image/jpeg;base64,${data['image/jpeg']}`} alt="output" />;
    }
    if (data['image/svg+xml']) {
      return <div className={styles.resultImage} dangerouslySetInnerHTML={{ __html: data['image/svg+xml'] }} />;
    }
    if (data['text/plain']) {
      return <pre className={styles.resultText}>{data['text/plain']}</pre>;
    }
  }
  return null;
}

export default NotebookEditor;
