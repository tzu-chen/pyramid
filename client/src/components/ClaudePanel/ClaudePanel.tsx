import { useState, useEffect, useRef, useCallback } from 'react';
import {
  claudeService,
  scribeService,
  type ClaudeMode,
  type ClaudeMessage,
  type ContextBlock,
  type ScribeNode,
} from '../../services/claudeService';
import { LspDiagnostic } from '../CodeEditor/CodeEditor';
import MarkdownRenderer from '../MarkdownRenderer/MarkdownRenderer';
import { fileService } from '../../services/fileService';
import { SessionLink, SessionFile, NotebookCellSnapshot } from '../../types';
import styles from './ClaudePanel.module.css';

type BlockSource = 'auto-file' | 'auto-diagnostics' | 'auto-goal' | 'auto-run' | 'scribe' | 'custom';

interface PanelContextBlock extends ContextBlock {
  source: BlockSource;
  editing?: boolean;
}

function isAutoSource(s: BlockSource): boolean {
  return s === 'auto-file' || s === 'auto-diagnostics' || s === 'auto-goal' || s === 'auto-run';
}

// First non-empty line of a cell's source, truncated — used in the cell picker.
function cellPreview(source: string): string {
  const line = source.split('\n').map(l => l.trim()).find(l => l.length > 0) || '';
  return line.length > 60 ? line.slice(0, 60) + '…' : (line || '(empty)');
}

// Render selected notebook cells as readable text context. `all` supplies the
// 1-based cell numbers so positions stay meaningful even with a partial pick.
function formatNotebookCells(chosen: NotebookCellSnapshot[], all: NotebookCellSnapshot[]): string {
  const numberById = new Map(all.map((c, i) => [c.id, i + 1]));
  return chosen
    .map(c => {
      const n = numberById.get(c.id);
      const head = c.cell_type === 'code'
        ? `[Cell ${n} · code${c.execution_count != null ? ` · In[${c.execution_count}]` : ''}]`
        : `[Cell ${n} · markdown]`;
      let body = `${head}\n${c.source.trim() ? c.source : '(empty)'}`;
      if (c.cell_type === 'code' && c.outputText) {
        body += `\n--- output ---\n${c.outputText}`;
      }
      return body;
    })
    .join('\n\n');
}

interface ClaudePanelProps {
  sessionId: string;
  sessionType: 'lean' | 'freeform';
  fileContent: string;
  fileName: string;
  /** Lean diagnostics from LSP */
  diagnostics?: LspDiagnostic[];
  /** Lean goal state */
  goalState?: string | null;
  /** Latest freeform execution run */
  lastRun?: { exit_code: number | null; stdout: string; stderr: string } | null;
  /** Session cross-app links */
  links?: SessionLink[];
  /** All files in the session, for the "+ From files" context picker */
  projectFiles?: SessionFile[];
  /** Notebook sessions: live getter for the open notebook's in-memory cells.
   *  When set, the current-file context is built from (selectable) cells and
   *  stays in sync with on-screen edits instead of the stale .ipynb on disk. */
  getNotebookCells?: () => NotebookCellSnapshot[];
  /** Changes whenever the notebook's cell structure changes (load/add/remove/
   *  reorder); used to re-sync the cell-picker display. */
  notebookCellsVersion?: string;
  /** Called when user clicks "Apply to editor" on a code block */
  onApplyCode?: (code: string) => void;
  /** If true, auto-activate error diagnosis mode */
  autoErrorMode?: boolean;
  /** Ref to focus prompt from outside */
  promptFocusRef?: React.MutableRefObject<(() => void) | null>;
}

function ClaudePanel({
  sessionId,
  sessionType,
  fileContent,
  fileName,
  diagnostics,
  goalState,
  lastRun,
  links,
  projectFiles,
  getNotebookCells,
  notebookCellsVersion,
  onApplyCode,
  autoErrorMode,
  promptFocusRef,
}: ClaudePanelProps) {
  const [contextBlocks, setContextBlocks] = useState<PanelContextBlock[]>([]);
  const [mode, setMode] = useState<ClaudeMode>('general');
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<ClaudeMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addingScribe, setAddingScribe] = useState(false);
  const [scribeSearch, setScribeSearch] = useState('');
  const [scribeResults, setScribeResults] = useState<ScribeNode[]>([]);
  const [scribeSearching, setScribeSearching] = useState(false);
  const [addingFile, setAddingFile] = useState(false);
  // Notebook cell selection (notebook sessions only). cellList is a snapshot for
  // the picker UI; the content actually sent is re-pulled fresh from
  // getNotebookCells() at build/send time so it reflects the latest edits.
  // Selection is tracked as the *deselected* ids so the default (empty set) means
  // "all cells", which stays correct even before the picker is first opened and
  // for cells added after.
  const [cellList, setCellList] = useState<NotebookCellSnapshot[]>([]);
  const [deselectedCellIds, setDeselectedCellIds] = useState<Set<string>>(new Set());
  const [showCellPicker, setShowCellPicker] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Expose focus function
  useEffect(() => {
    if (promptFocusRef) {
      promptFocusRef.current = () => promptRef.current?.focus();
    }
  }, [promptFocusRef]);

  // Load persisted chat history when session changes
  useEffect(() => {
    let cancelled = false;
    claudeService.getHistory(sessionId)
      .then(msgs => { if (!cancelled) setHistory(msgs); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [sessionId]);

  // Scroll transcript to bottom when history changes
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history.length, loading]);

  // Re-snapshot the notebook's cells into the picker (display only — selection
  // lives in deselectedCellIds). Called on mount, on structural changes (via
  // notebookCellsVersion), when the picker is opened, and via the Refresh button.
  const refreshCells = useCallback(() => {
    if (getNotebookCells) setCellList(getNotebookCells());
  }, [getNotebookCells]);

  // Snapshot on mount and whenever the notebook's cell structure changes (load,
  // add/remove/reorder) so the picker reflects the current cells.
  useEffect(() => { refreshCells(); }, [refreshCells, notebookCellsVersion]);

  const toggleCellPicker = () => {
    if (!showCellPicker) refreshCells();
    setShowCellPicker(v => !v);
  };
  const toggleCell = (cellId: string) => {
    setDeselectedCellIds(prev => {
      const next = new Set(prev);
      if (next.has(cellId)) next.delete(cellId); else next.add(cellId);
      return next;
    });
  };
  const selectAllCells = () => setDeselectedCellIds(new Set());
  const selectNoCells = () => setDeselectedCellIds(new Set(cellList.map(c => c.id)));
  const selectedCellCount = cellList.filter(c => !deselectedCellIds.has(c.id)).length;

  // Derive the auto-managed context blocks from current panel data. Called
  // both from the sync effect below and at send time so the outgoing payload
  // always carries the freshest file content / diagnostics / goal / last run.
  const buildAutoBlocks = useCallback((): PanelContextBlock[] => {
    const blocks: PanelContextBlock[] = [];

    if (getNotebookCells) {
      // Notebook: build from the live cells, minus any the user deselected.
      const cells = getNotebookCells();
      const chosen = cells.filter(c => !deselectedCellIds.has(c.id));
      if (chosen.length > 0) {
        const label = chosen.length === cells.length
          ? `Notebook: ${fileName} (all ${cells.length} cells)`
          : `Notebook: ${fileName} (${chosen.length}/${cells.length} cells)`;
        blocks.push({ label, content: formatNotebookCells(chosen, cells), source: 'auto-file' });
      }
    } else if (fileContent) {
      blocks.push({ label: `Current file: ${fileName}`, content: fileContent, source: 'auto-file' });
    }

    if (sessionType === 'lean') {
      if (diagnostics && diagnostics.length > 0) {
        const diagText = diagnostics.map(d => {
          const severity = d.severity === 1 ? 'Error' : d.severity === 2 ? 'Warning' : d.severity === 3 ? 'Info' : 'Hint';
          return `[${severity}] Line ${d.range.start.line + 1}: ${d.message}`;
        }).join('\n');
        blocks.push({ label: 'Diagnostics', content: diagText, source: 'auto-diagnostics' });
      }
      if (goalState) {
        blocks.push({ label: 'Goal state', content: goalState, source: 'auto-goal' });
      }
    } else {
      if (lastRun && (lastRun.exit_code !== 0 || lastRun.stderr)) {
        let output = '';
        if (lastRun.stdout) output += `stdout:\n${lastRun.stdout}\n\n`;
        if (lastRun.stderr) output += `stderr:\n${lastRun.stderr}`;
        blocks.push({ label: 'Last run output', content: output.trim(), source: 'auto-run' });
      }
    }

    return blocks;
  }, [fileContent, fileName, sessionType, diagnostics, goalState, lastRun, getNotebookCells, deselectedCellIds]);

  // Refresh auto blocks whenever their underlying data changes; preserve
  // user-added Scribe/custom blocks across edits.
  useEffect(() => {
    const autoBlocks = buildAutoBlocks();
    setContextBlocks(prev => {
      const userBlocks = prev.filter(b => !isAutoSource(b.source));
      return [...autoBlocks, ...userBlocks];
    });

    const hasErrors = sessionType === 'lean'
      ? diagnostics && diagnostics.some(d => d.severity === 1)
      : lastRun && (lastRun.exit_code !== 0 || lastRun.stderr);

    if (autoErrorMode || hasErrors) {
      setMode('error_diagnosis');
    }
  }, [buildAutoBlocks, sessionType, diagnostics, lastRun, autoErrorMode]);

  // Fetch Scribe context for linked nodes
  useEffect(() => {
    if (!links) return;
    const scribeLinks = links.filter(l => l.app === 'scribe' && l.ref_type === 'flowchart_node');
    for (const link of scribeLinks) {
      if (link.label) {
        scribeService.searchNodes(link.label).then(nodes => {
          if (nodes.length > 0) {
            const node = nodes[0];
            const content = formatScribeNode(node);
            setContextBlocks(prev => {
              if (prev.some(b => b.label === `Scribe: ${node.title}`)) return prev;
              return [...prev, { label: `Scribe: ${node.title}`, content, source: 'scribe' }];
            });
          }
        }).catch(() => {});
      }
    }

    // Book links carry their metadata directly (filename + optional page); no fetch needed.
    const bookLinks = links.filter(l => l.app === 'scribe' && l.ref_type === 'book');
    for (const link of bookLinks) {
      const title = link.label || link.ref_id;
      const label = `Scribe book: ${title}${link.page ? ` (p.${link.page})` : ''}`;
      const content = link.page ? `Book: ${title}\nPage: ${link.page}` : `Book: ${title}`;
      setContextBlocks(prev => {
        if (prev.some(b => b.label === label)) return prev;
        return [...prev, { label, content, source: 'scribe' }];
      });
    }
  }, [links]);

  const formatScribeNode = (node: ScribeNode): string => {
    let text = `Title: ${node.title}`;
    if (node.refs) text += `\nReferences: ${node.refs}`;
    if (node.topics) text += `\nTopics: ${node.topics}`;
    return text;
  };

  const handleRemoveBlock = (index: number) => {
    setContextBlocks(prev => prev.filter((_, i) => i !== index));
  };

  const handleToggleEdit = (index: number) => {
    setContextBlocks(prev => prev.map((b, i) => i === index ? { ...b, editing: !b.editing } : b));
  };

  const handleEditContent = (index: number, content: string) => {
    setContextBlocks(prev => prev.map((b, i) => i === index ? { ...b, content } : b));
  };

  const handleAddFreeText = () => {
    setContextBlocks(prev => [...prev, { label: 'Additional context', content: '', source: 'custom', editing: true }]);
  };

  const handleAddProjectFile = async (file: SessionFile) => {
    setAddingFile(false);
    const label = `File: ${file.filename}`;
    if (contextBlocks.some(b => b.label === label)) return;
    try {
      const content = await fileService.getContent(sessionId, file.id);
      setContextBlocks(prev =>
        prev.some(b => b.label === label)
          ? prev
          : [...prev, { label, content, source: 'custom' }]
      );
    } catch (err) {
      setError(`Couldn't load ${file.filename}: ${(err as Error).message}`);
    }
  };

  const handleScribeSearch = async () => {
    if (!scribeSearch.trim()) return;
    setScribeSearching(true);
    try {
      const results = await scribeService.searchNodes(scribeSearch);
      setScribeResults(results);
    } catch {
      setScribeResults([]);
    } finally {
      setScribeSearching(false);
    }
  };

  const handleAddScribeNode = (node: ScribeNode) => {
    const content = formatScribeNode(node);
    setContextBlocks(prev => [...prev, { label: `Scribe: ${node.title}`, content, source: 'scribe' }]);
    setAddingScribe(false);
    setScribeSearch('');
    setScribeResults([]);
  };

  const handleSend = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError('');

    try {
      // Rebuild auto blocks at send time from current props so the latest
      // file content / diagnostics / goal / run output go out even if a
      // recent edit hasn't yet propagated into contextBlocks state.
      const freshAutoBlocks = buildAutoBlocks();
      const userBlocks = contextBlocks.filter(b => !isAutoSource(b.source));
      const blocks: ContextBlock[] = [...freshAutoBlocks, ...userBlocks].map(
        ({ label, content }) => ({ label, content })
      );
      const result = await claudeService.ask(sessionId, prompt.trim(), blocks, mode);
      setHistory(prev => [...prev, result.user_message, result.assistant_message]);
      setPrompt('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleClearHistory = async () => {
    if (history.length === 0) return;
    if (!confirm('Clear the entire Claude chat history for this session? This cannot be undone.')) return;
    try {
      await claudeService.clearHistory(sessionId);
      setHistory([]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code).catch(() => {});
  };

  const modes: { value: ClaudeMode; label: string }[] = sessionType === 'lean'
    ? [
        { value: 'error_diagnosis', label: 'Error Diagnosis' },
        { value: 'formalization_help', label: 'Formalization Help' },
        { value: 'general', label: 'General' },
      ]
    : [
        { value: 'error_diagnosis', label: 'Error Diagnosis' },
        { value: 'implementation_help', label: 'Implementation Help' },
        { value: 'general', label: 'General' },
      ];

  const placeholders: Record<ClaudeMode, string> = {
    error_diagnosis: "What's wrong with this code?",
    formalization_help: 'Help me formalize this...',
    implementation_help: 'Implement this method...',
    general: 'Ask anything about your code...',
  };

  return (
    <div className={styles.panel}>
      {/* Chat transcript */}
      <div className={styles.transcript}>
        {history.length === 0 && !loading && (
          <div className={styles.transcriptEmpty}>
            No messages yet. Add context below and ask Claude anything about this session.
          </div>
        )}
        {history.map(msg => (
          <ChatTurn
            key={msg.id}
            message={msg}
            onCopy={handleCopyCode}
            onApply={onApplyCode}
          />
        ))}
        {loading && (
          <div className={styles.loadingRow}>Claude is thinking…</div>
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* Context blocks */}
      <div className={styles.contextArea}>
        <div className={styles.contextHeading}>
          <span className={styles.contextHeadingLabel}>Context for next message</span>
          {history.length > 0 && (
            <button className={styles.clearHistoryBtn} onClick={handleClearHistory} title="Clear chat history">
              Clear history
            </button>
          )}
        </div>

        {/* Notebook cell picker — choose which cells go into the context */}
        {getNotebookCells && (
          <div className={styles.cellPicker}>
            <div className={styles.cellPickerHeader}>
              <button className={styles.cellPickerToggle} onClick={toggleCellPicker}>
                <span className={styles.cellPickerChevron}>{showCellPicker ? '▾' : '▸'}</span>
                Notebook cells ({selectedCellCount}/{cellList.length})
              </button>
              {showCellPicker && (
                <div className={styles.cellPickerActions}>
                  <button className={styles.contextBtn} onClick={selectAllCells}>All</button>
                  <button className={styles.contextBtn} onClick={selectNoCells}>None</button>
                  <button className={styles.contextBtn} onClick={refreshCells} title="Re-sync with the notebook">↻</button>
                </div>
              )}
            </div>
            {showCellPicker && (
              <div className={styles.cellPickerList}>
                {cellList.length === 0 && <div className={styles.cellPickerEmpty}>No cells.</div>}
                {cellList.map((c, i) => (
                  <label key={c.id} className={styles.cellPickerItem}>
                    <input
                      type="checkbox"
                      checked={!deselectedCellIds.has(c.id)}
                      onChange={() => toggleCell(c.id)}
                    />
                    <span className={styles.cellPickerNum}>{i + 1}</span>
                    <span className={styles.cellPickerType}>{c.cell_type === 'code' ? 'code' : 'md'}</span>
                    <span className={styles.cellPickerText}>{cellPreview(c.source)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {contextBlocks.map((block, i) => (
          <div key={i} className={styles.contextBlock}>
            <div className={styles.contextHeader}>
              <span className={styles.contextLabel}>{block.label}</span>
              <div className={styles.contextActions}>
                <button className={styles.contextBtn} onClick={() => handleToggleEdit(i)} title="Edit">
                  {block.editing ? 'Done' : 'Edit'}
                </button>
                <button className={styles.contextBtn} onClick={() => handleRemoveBlock(i)} title="Remove">
                  &times;
                </button>
              </div>
            </div>
            {block.editing ? (
              <textarea
                className={styles.contextEditor}
                value={block.content}
                onChange={e => handleEditContent(i, e.target.value)}
                rows={6}
              />
            ) : (
              <pre className={styles.contextContent}>{block.content.slice(0, 500)}{block.content.length > 500 ? '...' : ''}</pre>
            )}
          </div>
        ))}
        <div className={styles.addContextRow}>
          <button className={styles.addContextBtn} onClick={handleAddFreeText}>+ Add context</button>
          {projectFiles && projectFiles.length > 0 && (
            <button className={styles.addContextBtn} onClick={() => { setAddingFile(!addingFile); setAddingScribe(false); }}>+ From files</button>
          )}
          <button className={styles.addContextBtn} onClick={() => { setAddingScribe(!addingScribe); setAddingFile(false); }}>+ From Scribe</button>
        </div>

        {addingFile && projectFiles && (
          <div className={styles.filePicker}>
            {projectFiles.length === 0 && <div className={styles.cellPickerEmpty}>No files.</div>}
            {projectFiles.map(file => (
              <button
                key={file.id}
                className={styles.filePickerItem}
                onClick={() => handleAddProjectFile(file)}
                title={`Add ${file.filename} to context`}
              >
                {file.filename}
              </button>
            ))}
          </div>
        )}

        {addingScribe && (
          <div className={styles.scribePicker}>
            <div className={styles.scribeSearchRow}>
              <input
                className={styles.scribeInput}
                type="text"
                value={scribeSearch}
                onChange={e => setScribeSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleScribeSearch()}
                placeholder="Search Scribe nodes by title..."
              />
              <button className={styles.scribeSearchBtn} onClick={handleScribeSearch} disabled={scribeSearching}>
                {scribeSearching ? '...' : 'Search'}
              </button>
            </div>
            {scribeResults.length > 0 && (
              <div className={styles.scribeResults}>
                {scribeResults.map(node => (
                  <button
                    key={node.node_key}
                    className={styles.scribeResultItem}
                    onClick={() => handleAddScribeNode(node)}
                  >
                    <span className={styles.scribeNodeTitle}>{node.title}</span>
                    {node.flowchart_name && (
                      <span className={styles.scribeFlowchart}>{node.flowchart_name}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mode selector */}
      <div className={styles.modeRow}>
        <div className={styles.modeSelector}>
          {modes.map(m => (
            <button
              key={m.value}
              className={`${styles.modeBtn} ${mode === m.value ? styles.modeBtnActive : ''}`}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Prompt */}
      <div className={styles.promptArea}>
        <textarea
          ref={promptRef}
          className={styles.promptInput}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholders[mode]}
          rows={3}
        />
        <button className={styles.sendBtn} onClick={handleSend} disabled={loading || !prompt.trim()}>
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>

      {/* Error */}
      {error && <div className={styles.errorMsg}>{error}</div>}
    </div>
  );
}

/** Renders a single chat turn (user or assistant). */
function ChatTurn({
  message,
  onCopy,
  onApply,
}: {
  message: ClaudeMessage;
  onCopy: (code: string) => void;
  onApply?: (code: string) => void;
}) {
  const isUser = message.role === 'user';
  const displayContent = isUser ? (message.display_prompt ?? message.content) : message.content;
  const timestamp = new Date(message.created_at).toLocaleString();

  return (
    <div className={`${styles.turn} ${isUser ? styles.turnUser : styles.turnAssistant}`}>
      <div className={styles.turnHeader}>
        <span className={styles.turnRole}>{isUser ? 'You' : 'Claude'}</span>
        <span className={styles.turnMeta}>
          {timestamp}
          {!isUser && message.input_tokens !== null && message.output_tokens !== null && (
            <> · {message.input_tokens.toLocaleString()} in / {message.output_tokens.toLocaleString()} out</>
          )}
        </span>
      </div>
      <div className={styles.turnBody}>
        {isUser ? (
          <pre className={styles.userText}>{displayContent}</pre>
        ) : (
          <ResponseRenderer
            content={displayContent}
            onCopy={onCopy}
            onApply={onApply}
          />
        )}
      </div>
    </div>
  );
}

/** Renders Claude's markdown response with "Copy" and "Apply" buttons on code blocks */
function ResponseRenderer({
  content,
  onCopy,
  onApply,
}: {
  content: string;
  onCopy: (code: string) => void;
  onApply?: (code: string) => void;
}) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className={styles.response}>
      {parts.map((part, i) => {
        const codeMatch = part.match(/^```\w*\n([\s\S]*?)```$/);
        if (codeMatch) {
          const code = codeMatch[1];
          return (
            <div key={i} className={styles.codeBlockWrapper}>
              <pre className={styles.codeBlock}><code>{code}</code></pre>
              <div className={styles.codeActions}>
                <button className={styles.codeActionBtn} onClick={() => onCopy(code)}>Copy</button>
                {onApply && (
                  <button
                    className={styles.codeActionBtn}
                    onClick={() => {
                      if (confirm('Replace current file content with this code?')) {
                        onApply(code);
                      }
                    }}
                  >
                    Apply to editor
                  </button>
                )}
              </div>
            </div>
          );
        }
        if (part.trim()) {
          return <MarkdownRenderer key={i} content={part} />;
        }
        return null;
      })}
    </div>
  );
}

export default ClaudePanel;
