import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeEditor, { ExternalCompletionSource } from '../CodeEditor/CodeEditor';
import MarkdownRenderer from '../MarkdownRenderer/MarkdownRenderer';
import { useNotebookKernel, KernelStatus, CellOutput } from '../../hooks/useNotebookKernel';
import { useDebounce } from '../../hooks/useDebounce';
import { fileService } from '../../services/fileService';
import styles from './NotebookEditor.module.css';

type CellType = 'code' | 'markdown';

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

function NotebookEditor({ sessionId, fileId, fontSize }: NotebookEditorProps) {
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [loadedFileId, setLoadedFileId] = useState<string | null>(null);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const notebookDataRef = useRef<Notebook | null>(null);
  notebookDataRef.current = notebook;
  const notebookRef = useRef<HTMLDivElement>(null);
  const lastDPressRef = useRef<number>(0);

  // Load notebook from disk when fileId changes
  useEffect(() => {
    let cancelled = false;
    fileService.getContent(sessionId, fileId).then(content => {
      if (cancelled) return;
      const parsed = parseNotebook(content);
      setNotebook(parsed);
      setLoadedFileId(fileId);
      setActiveCellId(parsed.cells[0]?.id || null);
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
        case 'execute_reply':
          if (typeof event.execution_count === 'number') newCount = event.execution_count;
          break;
        default:
          return prev;
      }

      const newCells = [...prev.cells];
      newCells[idx] = { ...cell, outputs: newOutputs, execution_count: newCount };
      return { ...prev, cells: newCells };
    });
  }, []);

  const kernel = useNotebookKernel({
    sessionId,
    enabled: true,
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
    // clear outputs for this cell then send
    setNotebook(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        cells: prev.cells.map(c => c.id === cellId ? { ...c, outputs: [], execution_count: null } : c),
      };
    });
    kernel.executeCell(cellId, cell.source);
  }, [kernel]);

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

  const insertCell = useCallback((afterId: string | null, type: CellType) => {
    setNotebook(prev => {
      if (!prev) return prev;
      const newCell: NotebookCell = { id: newId(), cell_type: type, source: '', outputs: [], execution_count: null };
      if (afterId === null) {
        return { ...prev, cells: [newCell, ...prev.cells] };
      }
      const idx = prev.cells.findIndex(c => c.id === afterId);
      const next = [...prev.cells];
      next.splice(idx + 1, 0, newCell);
      setActiveCellId(newCell.id);
      return { ...prev, cells: next };
    });
  }, []);

  const insertCellAt = useCallback((index: number, type: CellType) => {
    setNotebook(prev => {
      if (!prev) return prev;
      const newCell: NotebookCell = { id: newId(), cell_type: type, source: '', outputs: [], execution_count: null };
      const next = [...prev.cells];
      next.splice(index, 0, newCell);
      setActiveCellId(newCell.id);
      return { ...prev, cells: next };
    });
  }, []);

  const deleteCell = useCallback((cellId: string) => {
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

  const focusActiveCellEditor = useCallback((cellId: string) => {
    const root = notebookRef.current;
    if (!root) return;
    const cellEl = root.querySelector(`[data-cell-id="${cellId}"]`);
    if (!cellEl) return;
    const cm = cellEl.querySelector<HTMLElement>('.cm-content');
    if (cm) { cm.focus(); return; }
    const ta = cellEl.querySelector<HTMLTextAreaElement>('textarea');
    if (ta) ta.focus();
  }, []);

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
      case 'ArrowDown':
        if (idx + 1 < nb.cells.length) {
          e.preventDefault();
          setActiveCellId(nb.cells[idx + 1].id);
        }
        break;
      case 'k':
      case 'ArrowUp':
        if (idx > 0) {
          e.preventDefault();
          setActiveCellId(nb.cells[idx - 1].id);
        }
        break;
      case 'Enter':
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          focusActiveCellEditor(activeCellId);
        }
        break;
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
  }, [activeCellId, insertCellAt, changeCellType, deleteCell, focusActiveCellEditor]);

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
        <button onClick={runAll} disabled={kernel.status !== 'idle' && kernel.status !== 'busy'}>Run All</button>
        <button onClick={kernel.interrupt} disabled={kernel.status !== 'busy'}>Interrupt</button>
        <button onClick={kernel.restart} disabled={kernel.status === 'disconnected' || kernel.status === 'connecting'}>Restart</button>
      </div>

      <div className={styles.cellList}>
        {notebook.cells.map(cell => (
          <CellView
            key={cell.id}
            cell={cell}
            active={cell.id === activeCellId}
            running={kernel.runningCellId === cell.id}
            kernelIdle={kernel.status === 'idle' || kernel.status === 'busy'}
            fontSize={fontSize}
            onFocus={() => setActiveCellId(cell.id)}
            onChange={(src) => updateCellSource(cell.id, src)}
            onRun={() => runCell(cell.id)}
            onDelete={() => deleteCell(cell.id)}
            onMoveUp={() => moveCell(cell.id, -1)}
            onMoveDown={() => moveCell(cell.id, 1)}
            onInsertBelow={(type) => insertCell(cell.id, type)}
            onChangeType={(type) => changeCellType(cell.id, type)}
            onToggleOutputs={() => toggleOutputsCollapsed(cell.id)}
            completionSource={completionSource}
          />
        ))}
      </div>

      <div className={styles.addCellBar}>
        <button onClick={() => insertCell(notebook.cells[notebook.cells.length - 1]?.id ?? null, 'code')}>+ Code</button>
        <button onClick={() => insertCell(notebook.cells[notebook.cells.length - 1]?.id ?? null, 'markdown')}>+ Markdown</button>
      </div>
    </div>
  );
}

interface CellViewProps {
  cell: NotebookCell;
  active: boolean;
  running: boolean;
  kernelIdle: boolean;
  fontSize: number;
  onFocus: () => void;
  onChange: (src: string) => void;
  onRun: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onInsertBelow: (type: CellType) => void;
  onChangeType: (type: CellType) => void;
  onToggleOutputs: () => void;
  completionSource?: ExternalCompletionSource;
}

function CellView(props: CellViewProps) {
  const { cell, active, running, kernelIdle, fontSize, onFocus, onChange, onRun, onDelete, onMoveUp, onMoveDown, onInsertBelow, onChangeType, onToggleOutputs, completionSource } = props;
  const outputsCollapsed = !!(cell.metadata as Record<string, unknown> | undefined)?.collapsed;
  const [mdEditing, setMdEditing] = useState(cell.source === '' && cell.cell_type === 'markdown');

  const executionMark = cell.cell_type === 'code'
    ? (running ? '[*]' : cell.execution_count != null ? `[${cell.execution_count}]` : '[ ]')
    : '';

  return (
    <>
      <div className={`${styles.cell} ${active ? styles.cellActive : ''}`} data-cell-id={cell.id} onClick={onFocus}>
        <div className={styles.cellHeader}>
          <span className={styles.cellLabel}>{cell.cell_type}</span>
          <div className={styles.cellActions}>
            {cell.cell_type === 'code' && (
              <button onClick={(e) => { e.stopPropagation(); onRun(); }} disabled={!kernelIdle || running} title="Run cell (Shift+Enter)">Run</button>
            )}
            <button onClick={(e) => { e.stopPropagation(); onChangeType(cell.cell_type === 'code' ? 'markdown' : 'code'); }}>
              {cell.cell_type === 'code' ? '→ md' : '→ code'}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} title="Move up">↑</button>
            <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} title="Move down">↓</button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete cell">×</button>
          </div>
        </div>
        <div className={styles.cellBody}>
          {cell.cell_type === 'code' && (
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
                  }
                }}
              >
                <CodeEditor
                  value={cell.source}
                  language="python"
                  onChange={onChange}
                  fontSize={fontSize}
                  externalCompletion={completionSource}
                />
              </div>
            ) : mdEditing ? (
              <textarea
                className={styles.markdownTextarea}
                value={cell.source}
                onChange={(e) => onChange(e.target.value)}
                onBlur={() => setMdEditing(false)}
                onKeyDown={(e) => {
                  if (e.shiftKey && e.key === 'Enter') {
                    e.preventDefault();
                    setMdEditing(false);
                  }
                }}
                placeholder="Markdown (supports LaTeX with $...$ and $$...$$)..."
                autoFocus
              />
            ) : (
              <div className={styles.markdownArea} onClick={(e) => { e.stopPropagation(); setMdEditing(true); }}>
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
      <div className={styles.insertBelow}>
        <button onClick={() => onInsertBelow('code')}>+ code below</button>
        <button onClick={() => onInsertBelow('markdown')}>+ md below</button>
      </div>
    </>
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
