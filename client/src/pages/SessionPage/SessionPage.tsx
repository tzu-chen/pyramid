import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';
import { useDebounce } from '../../hooks/useDebounce';
import { useLeanLsp } from '../../hooks/useLeanLsp';
import { fileService } from '../../services/fileService';
import { executionService } from '../../services/executionService';
import { sessionService } from '../../services/sessionService';
import { leanService } from '../../services/leanService';
import { scribeService, type ScribeNode } from '../../services/claudeService';
import CodeEditor from '../../components/CodeEditor/CodeEditor';
import ClaudePanel from '../../components/ClaudePanel/ClaudePanel';
import MarkdownRenderer from '../../components/MarkdownRenderer/MarkdownRenderer';
import GoalStatePanel from '../../components/GoalStatePanel/GoalStatePanel';
import SymbolPalette from '../../components/SymbolPalette/SymbolPalette';
import Badge from '../../components/Badge/Badge';
import FileTree from '../../components/FileTree/FileTree';
import NotebookEditor from '../../components/NotebookEditor/NotebookEditor';
import { useEditorFontSize } from '../../contexts/EditorFontSizeContext';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { ExecutionRun, SessionFile, SessionLink, LakeStatus, LinkApp, RefType } from '../../types';
import styles from './SessionPage.module.css';

type NonLeanTab = 'output' | 'claude' | 'notes' | 'links';
type LeanTab = 'goalState' | 'messages' | 'claude' | 'notes' | 'links';

function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const { session, loading, error, refresh } = useSession(id);

  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [activeTab, setActiveTab] = useState<NonLeanTab | LeanTab>('output');
  const [notes, setNotes] = useState('');
  const [notesEditing, setNotesEditing] = useState(false);
  const [runs, setRuns] = useState<ExecutionRun[]>([]);
  const [executing, setExecuting] = useState(false);
  const [autoErrorMode, setAutoErrorMode] = useState(false);
  const claudePromptFocusRef = useRef<(() => void) | null>(null);

  // Link management state
  const [linkAddMode, setLinkAddMode] = useState<'scribe' | 'navigate' | 'granary' | 'monolith' | null>(null);
  const [linkScribeSearch, setLinkScribeSearch] = useState('');
  const [linkScribeResults, setLinkScribeResults] = useState<ScribeNode[]>([]);
  const [linkScribeSearching, setLinkScribeSearching] = useState(false);
  const [linkInputValue, setLinkInputValue] = useState('');

  // Editor font size and symbol insertion
  const { fontSize } = useEditorFontSize();
  const insertRef = useRef<((text: string) => void) | null>(null);

  // Resizable split pane
  const { ratio, onDragStart, containerRef } = useResizablePanel({
    storageKey: 'pyramid_panel_ratio',
    defaultRatio: 0.6,
    minRatio: 0.25,
    maxRatio: 0.8,
  });

  // Lean-specific state
  const [building, setBuilding] = useState(false);
  const [lakeStatus, setLakeStatus] = useState<LakeStatus>('initializing');
  const [buildOutput, setBuildOutput] = useState('');

  const isLean = session?.session_type === 'lean';
  const isNotebook = session?.session_type === 'notebook';

  // Lean LSP hook
  const leanProjectPath = session?.lean_meta?.absolute_project_path ?? null;
  const lsp = useLeanLsp(id, isLean, leanProjectPath);

  const debouncedNotes = useDebounce(notes, 1500);
  const prevNotesRef = useRef('');
  const fileUriRef = useRef<string | null>(null);
  const lspOpenedFileRef = useRef<string | null>(null);

  // Compute file URI for LSP
  const getFileUri = useCallback((filename: string) => {
    if (!session) return '';
    if (session.session_type === 'lean' && session.lean_meta?.absolute_project_path) {
      return `file://${session.lean_meta.absolute_project_path}/${filename}`;
    }
    return `file://${session.working_dir.startsWith('/') ? '' : '/'}${session.working_dir}/${filename}`;
  }, [session]);

  // Load first file when session loads
  useEffect(() => {
    if (session?.files && session.files.length > 0) {
      const primary = session.files.find(f => f.is_primary) || session.files[0];
      setActiveFileId(primary.id);
      setNotes(session.notes);
      prevNotesRef.current = session.notes;
      setRuns(session.runs || []);

      // Set default tab based on session type
      if (session.session_type === 'lean') {
        setActiveTab('goalState');
      } else if (session.session_type === 'notebook') {
        setActiveTab('claude');
      } else {
        setActiveTab('output');
      }

      // Load lean metadata
      if (session.lean_meta) {
        setLakeStatus(session.lean_meta.lake_status);
        setBuildOutput(session.lean_meta.last_build_output);
      }
    }
  }, [session?.id]);

  // Load file content
  useEffect(() => {
    if (id && activeFileId) {
      fileService.getContent(id, activeFileId).then((content) => {
        setFileContent(content);
      }).catch(() => {});
    }
  }, [id, activeFileId]);

  // Reset LSP opened-file tracking on file switch or reconnection
  useEffect(() => {
    lspOpenedFileRef.current = null;
  }, [activeFileId, lsp.initialized]);

  // Send didOpen and set fileUriRef when all conditions are met
  useEffect(() => {
    if (!isLean || !lsp.initialized || !fileContent || !session?.files || !activeFileId) return;
    const file = session.files.find(f => f.id === activeFileId);
    if (!file) return;
    const uri = getFileUri(file.filename);
    fileUriRef.current = uri;
    if (lspOpenedFileRef.current !== uri) {
      lsp.sendDidOpen(uri, fileContent);
      lspOpenedFileRef.current = uri;
    }
  }, [isLean, lsp.initialized, fileContent, activeFileId, session?.files, getFileUri, lsp.sendDidOpen]);

  // Auto-save notes
  useEffect(() => {
    if (id && debouncedNotes !== prevNotesRef.current && notesEditing) {
      sessionService.update(id, { notes: debouncedNotes }).catch(() => {});
      prevNotesRef.current = debouncedNotes;
    }
  }, [id, debouncedNotes, notesEditing]);

  // Poll lake status while initializing
  useEffect(() => {
    if (!isLean || !id || lakeStatus !== 'initializing') return;
    const interval = setInterval(async () => {
      try {
        const meta = await leanService.getMeta(id);
        setLakeStatus(meta.lake_status);
        if (meta.lake_status !== 'initializing') {
          setBuildOutput(meta.last_build_output);
        }
      } catch { /* */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [isLean, id, lakeStatus]);

  // Use refs for LSP methods so callbacks stay stable
  const lspRef = useRef(lsp);
  lspRef.current = lsp;

  const handleSaveFile = useCallback(async (content: string) => {
    if (id && activeFileId) {
      setFileContent(content);
      await fileService.updateContent(id, activeFileId, content).catch(() => {});

      // Send didChange to LSP
      if (isLean && fileUriRef.current) {
        lspRef.current.sendDidChange(fileUriRef.current, content);
      }
    }
  }, [id, activeFileId, isLean]);

  const handleCursorChange = useCallback((position: { line: number; character: number }) => {
    if (isLean && fileUriRef.current) {
      lspRef.current.requestGoalState(fileUriRef.current, position.line, position.character);
    }
  }, [isLean]);

  const handleExecute = async () => {
    if (!id || executing) return;
    setExecuting(true);
    try {
      const run = await executionService.execute(id, activeFileId ? { file_id: activeFileId } : undefined);
      setRuns(prev => [run, ...prev]);
      setActiveTab('output');
    } catch (err) {
      console.error(err);
    } finally {
      setExecuting(false);
    }
  };

  const handleBuild = async () => {
    if (!id || building) return;
    setBuilding(true);
    setLakeStatus('building');
    try {
      const result = await leanService.build(id);
      setBuildOutput(result.build_output);
      setLakeStatus(result.lake_status as LakeStatus);
      setActiveTab('messages');
    } catch (err) {
      console.error(err);
      setLakeStatus('error');
    } finally {
      setBuilding(false);
    }
  };

  const handleAskClaude = () => {
    setAutoErrorMode(true);
    setActiveTab('claude');
    setTimeout(() => claudePromptFocusRef.current?.(), 100);
  };

  const handleApplyCode = useCallback((code: string) => {
    if (isNotebook) return; // would overwrite .ipynb JSON — user copies manually
    if (id && activeFileId) {
      setFileContent(code);
      fileService.updateContent(id, activeFileId, code).catch(() => {});
      if (isLean && fileUriRef.current) {
        lspRef.current.sendDidChange(fileUriRef.current, code);
      }
    }
  }, [id, activeFileId, isLean, isNotebook]);

  const updateLinks = async (newLinks: SessionLink[]) => {
    if (!id || !session) return;
    try {
      await sessionService.update(id, { links: newLinks });
      refresh();
    } catch { /* */ }
  };

  const handleScribeLinkSearch = async () => {
    if (!linkScribeSearch.trim()) return;
    setLinkScribeSearching(true);
    try {
      const results = await scribeService.searchNodes(linkScribeSearch);
      setLinkScribeResults(results);
    } catch {
      setLinkScribeResults([]);
    } finally {
      setLinkScribeSearching(false);
    }
  };

  const handleAddScribeLink = (node: ScribeNode) => {
    if (!session) return;
    const newLink: SessionLink = {
      app: 'scribe',
      ref_type: 'flowchart_node',
      ref_id: node.node_key,
      label: node.title,
    };
    updateLinks([...session.links, newLink]);
    setLinkAddMode(null);
    setLinkScribeSearch('');
    setLinkScribeResults([]);
  };

  const handleAddTextLink = () => {
    if (!session || !linkAddMode || linkAddMode === 'scribe' || !linkInputValue.trim()) return;
    const appRefMap: Record<string, { app: LinkApp; ref_type: RefType }> = {
      navigate: { app: 'navigate', ref_type: 'arxiv_id' },
      granary: { app: 'granary', ref_type: 'entry_id' },
      monolith: { app: 'monolith', ref_type: 'project' },
    };
    const { app, ref_type } = appRefMap[linkAddMode];
    const newLink: SessionLink = { app, ref_type, ref_id: linkInputValue.trim() };
    updateLinks([...session.links, newLink]);
    setLinkAddMode(null);
    setLinkInputValue('');
  };

  const handleRemoveLink = (index: number) => {
    if (!session) return;
    updateLinks(session.links.filter((_, i) => i !== index));
  };

  const handleStatusChange = async (status: string) => {
    if (!id) return;
    await sessionService.updateStatus(id, status as 'active' | 'paused' | 'completed' | 'archived');
    refresh();
  };

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (error) return <div className={styles.error}>Error: {error}</div>;
  if (!session) return <div className={styles.error}>Session not found</div>;

  const latestRun = runs[0];

  // Lake status badge variant
  const lakeStatusVariant = lakeStatus === 'ready' ? 'success'
    : lakeStatus === 'error' ? 'danger'
    : lakeStatus === 'building' ? 'warning'
    : 'default';

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <h2 className={styles.sessionTitle}>{session.title}</h2>
          <Badge label={session.session_type} variant={session.session_type as 'freeform' | 'lean' | 'notebook'} />
          <Badge label={session.language} />
          {isLean && (
            <Badge label={lakeStatus} variant={lakeStatusVariant} />
          )}
        </div>
        <div className={styles.toolbarRight}>
          <select
            className={styles.statusSelect}
            value={session.status}
            onChange={e => handleStatusChange(e.target.value)}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
          {isLean ? (
            <>
              <button className={styles.buildButton} onClick={handleBuild} disabled={building || lakeStatus === 'initializing'}>
                {building ? 'Building...' : 'Build'}
              </button>
              {lsp.diagnostics.some(d => d.severity === 1) && (
                <button className={styles.askClaudeButton} onClick={handleAskClaude}>Ask Claude</button>
              )}
            </>
          ) : isNotebook ? null : (
            <>
              <button className={styles.runButton} onClick={handleExecute} disabled={executing}>
                {executing ? 'Running...' : 'Run'}
              </button>
              {latestRun && (latestRun.exit_code !== 0 || latestRun.stderr) && (
                <button className={styles.askClaudeButton} onClick={handleAskClaude}>Ask Claude</button>
              )}
            </>
          )}
        </div>
      </div>

      <div className={styles.workbench} ref={containerRef}>
        <div className={styles.editorPane} style={{ flexBasis: `${ratio * 100}%` }}>
          {isNotebook && activeFileId ? (
            <NotebookEditor sessionId={id!} fileId={activeFileId} fontSize={fontSize} />
          ) : isLean ? (
            <>
              {session.files.length > 1 && (
                <div className={styles.fileTabs}>
                  {session.files.map((f: SessionFile) => (
                    <button
                      key={f.id}
                      className={`${styles.fileTab} ${activeFileId === f.id ? styles.fileTabActive : ''}`}
                      onClick={() => setActiveFileId(f.id)}
                    >
                      {f.filename}
                    </button>
                  ))}
                </div>
              )}
              <SymbolPalette onInsert={(s) => insertRef.current?.(s)} />
              <div className={styles.editorContainer}>
                <CodeEditor
                  value={fileContent}
                  language={session.language}
                  onChange={handleSaveFile}
                  onCursorChange={handleCursorChange}
                  diagnostics={lsp.diagnostics}
                  fontSize={fontSize}
                  onInsertRef={insertRef}
                />
              </div>
            </>
          ) : (
            <div className={styles.editorWithTree}>
              <div className={styles.fileTreePanel}>
                <FileTree
                  sessionId={id!}
                  files={session.files}
                  activeFileId={activeFileId}
                  onSelectFile={setActiveFileId}
                  onFilesChanged={refresh}
                  sessionLanguage={session.language}
                />
              </div>
              <div className={styles.editorContainer}>
                <CodeEditor
                  value={fileContent}
                  language={session.language}
                  onChange={handleSaveFile}
                  fontSize={fontSize}
                  onInsertRef={insertRef}
                />
              </div>
            </div>
          )}
        </div>

        <div
          className={styles.divider}
          onMouseDown={onDragStart}
          onTouchStart={onDragStart}
        />
        <div className={styles.rightPane} style={{ flexBasis: `${(1 - ratio) * 100}%`, '--panel-font-size': `${fontSize}px` } as React.CSSProperties}>
          <div className={styles.tabs}>
            {isLean ? (
              <>
                <button
                  className={`${styles.tab} ${activeTab === 'goalState' ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab('goalState')}
                >
                  Goal State
                </button>
                <button
                  className={`${styles.tab} ${activeTab === 'messages' ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab('messages')}
                >
                  Messages
                </button>
                <button
                  className={`${styles.tab} ${activeTab === 'claude' ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab('claude')}
                >
                  Claude
                </button>
                <button
                  className={`${styles.tab} ${activeTab === 'notes' ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab('notes')}
                >
                  Notes
                </button>
                <button
                  className={`${styles.tab} ${activeTab === 'links' ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab('links')}
                >
                  Links
                </button>
              </>
            ) : (
              <>
                {!isNotebook && (
                  <button
                    className={`${styles.tab} ${activeTab === 'output' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('output')}
                  >
                    Output
                  </button>
                )}
                <button
                  className={`${styles.tab} ${activeTab === 'claude' ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab('claude')}
                >
                  Claude
                </button>
                <button
                  className={`${styles.tab} ${activeTab === 'notes' ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab('notes')}
                >
                  Notes
                </button>
                <button
                  className={`${styles.tab} ${activeTab === 'links' ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab('links')}
                >
                  Links
                </button>
              </>
            )}
          </div>

          <div className={styles.tabContent}>
            {/* Lean: Goal State */}
            {activeTab === 'goalState' && isLean && (
              <GoalStatePanel
                goalState={lsp.goalState}
                connected={lsp.connected}
                initialized={lsp.initialized}
              />
            )}

            {/* Lean: Messages */}
            {activeTab === 'messages' && isLean && (
              <div className={styles.messagesPane}>
                {buildOutput && (
                  <div className={styles.buildOutputSection}>
                    <div className={styles.buildOutputHeader}>Build Output</div>
                    <pre className={styles.buildOutputContent}>{buildOutput}</pre>
                  </div>
                )}
                {lsp.messages.length > 0 ? (
                  <div className={styles.lspMessages}>
                    {lsp.messages.map((msg, i) => (
                      <div key={i} className={styles.lspMessage}>{msg}</div>
                    ))}
                  </div>
                ) : !buildOutput ? (
                  <div className={styles.placeholder}>No messages yet</div>
                ) : null}
              </div>
            )}

            {/* Links */}
            {activeTab === 'links' && (
              <div className={styles.linksPane}>
                {session.links && session.links.length > 0 && (
                  <div className={styles.linksList}>
                    {session.links.map((link, i) => (
                      <div key={i} className={styles.linkItem}>
                        <Badge label={link.app} />
                        <span className={styles.linkRef}>
                          {link.label || link.ref_id}
                        </span>
                        {link.label && (
                          <span className={styles.linkMeta}>{link.ref_type}: {link.ref_id}</span>
                        )}
                        <button
                          className={styles.linkRemoveBtn}
                          onClick={() => handleRemoveLink(i)}
                          title="Remove link"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className={styles.addLinkRow}>
                  {!linkAddMode ? (
                    <div className={styles.addLinkButtons}>
                      <button className={styles.addLinkBtn} onClick={() => setLinkAddMode('scribe')}>+ Scribe</button>
                      <button className={styles.addLinkBtn} onClick={() => setLinkAddMode('navigate')}>+ Navigate</button>
                      <button className={styles.addLinkBtn} onClick={() => setLinkAddMode('granary')}>+ Granary</button>
                      <button className={styles.addLinkBtn} onClick={() => setLinkAddMode('monolith')}>+ Monolith</button>
                    </div>
                  ) : linkAddMode === 'scribe' ? (
                    <div className={styles.linkForm}>
                      <div className={styles.linkFormHeader}>
                        <span>Link to Scribe node</span>
                        <button className={styles.linkFormCancel} onClick={() => { setLinkAddMode(null); setLinkScribeSearch(''); setLinkScribeResults([]); }}>&times;</button>
                      </div>
                      <div className={styles.linkFormRow}>
                        <input
                          className={styles.linkFormInput}
                          type="text"
                          value={linkScribeSearch}
                          onChange={e => setLinkScribeSearch(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleScribeLinkSearch()}
                          placeholder="Search Scribe nodes by title..."
                          autoFocus
                        />
                        <button className={styles.linkFormBtn} onClick={handleScribeLinkSearch} disabled={linkScribeSearching}>
                          {linkScribeSearching ? '...' : 'Search'}
                        </button>
                      </div>
                      {linkScribeResults.length > 0 && (
                        <div className={styles.linkScribeResults}>
                          {linkScribeResults.map(node => (
                            <button
                              key={node.node_key}
                              className={styles.linkScribeResultItem}
                              onClick={() => handleAddScribeLink(node)}
                            >
                              <span className={styles.linkScribeTitle}>{node.title}</span>
                              {node.flowchart_name && (
                                <span className={styles.linkScribeFlowchart}>{node.flowchart_name}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={styles.linkForm}>
                      <div className={styles.linkFormHeader}>
                        <span>Link to {linkAddMode.charAt(0).toUpperCase() + linkAddMode.slice(1)} {linkAddMode === 'navigate' ? '(arXiv ID)' : linkAddMode === 'granary' ? '(entry ID)' : '(project name)'}</span>
                        <button className={styles.linkFormCancel} onClick={() => { setLinkAddMode(null); setLinkInputValue(''); }}>&times;</button>
                      </div>
                      <div className={styles.linkFormRow}>
                        <input
                          className={styles.linkFormInput}
                          type="text"
                          value={linkInputValue}
                          onChange={e => setLinkInputValue(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleAddTextLink()}
                          placeholder={linkAddMode === 'navigate' ? '2301.12345' : linkAddMode === 'granary' ? 'Entry ID...' : 'Project name...'}
                          autoFocus
                        />
                        <button className={styles.linkFormBtn} onClick={handleAddTextLink} disabled={!linkInputValue.trim()}>
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {(!session.links || session.links.length === 0) && !linkAddMode && (
                  <div className={styles.placeholder}>No cross-app links</div>
                )}
              </div>
            )}

            {/* Non-lean: Output */}
            {activeTab === 'output' && !isLean && (
              <div className={styles.outputPane}>
                {latestRun ? (
                  <div className={styles.runOutput}>
                    <div className={styles.runHeader}>
                      <span className={styles.runCommand}>{latestRun.command}</span>
                      <span className={styles.runMeta}>
                        {latestRun.exit_code !== null ? `exit ${latestRun.exit_code}` : 'timed out'} | {latestRun.duration_ms}ms
                      </span>
                    </div>
                    {latestRun.stdout && (
                      <pre className={styles.stdout}>{latestRun.stdout}</pre>
                    )}
                    {latestRun.stderr && (
                      <pre className={styles.stderr}>{latestRun.stderr}</pre>
                    )}
                  </div>
                ) : (
                  <div className={styles.placeholder}>Run your code to see output here</div>
                )}

                {runs.length > 1 && (
                  <div className={styles.runHistory}>
                    <h4 className={styles.historyTitle}>History</h4>
                    {runs.slice(1).map(run => (
                      <div key={run.id} className={styles.historyItem}>
                        <span className={styles.historyMeta}>
                          {run.exit_code !== null ? `exit ${run.exit_code}` : 'timeout'} | {run.duration_ms}ms | {new Date(run.created_at).toLocaleTimeString()}
                        </span>
                        {run.stdout && <pre className={styles.historyOutput}>{run.stdout.slice(0, 200)}</pre>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Claude */}
            {activeTab === 'claude' && (
              <ClaudePanel
                sessionId={id!}
                sessionType={isLean ? 'lean' : 'freeform'}
                fileContent={fileContent}
                fileName={session.files.find(f => f.id === activeFileId)?.filename || ''}
                diagnostics={isLean ? lsp.diagnostics : undefined}
                goalState={isLean ? lsp.goalState : undefined}
                lastRun={!isLean ? latestRun : undefined}
                links={session.links}
                onApplyCode={handleApplyCode}
                autoErrorMode={autoErrorMode}
                promptFocusRef={claudePromptFocusRef}
              />
            )}

            {/* Shared: Notes */}
            {activeTab === 'notes' && (
              <div className={styles.notesPane}>
                {notesEditing ? (
                  <textarea
                    className={styles.notesEditor}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    onBlur={() => setNotesEditing(false)}
                    placeholder="Write session notes here (Markdown + LaTeX supported)..."
                    autoFocus
                  />
                ) : (
                  <div className={styles.notesDisplay} onClick={() => setNotesEditing(true)}>
                    {notes ? (
                      <MarkdownRenderer content={notes} />
                    ) : (
                      <span className={styles.placeholder}>Click to add notes (Markdown + LaTeX supported)</span>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

export default SessionPage;
