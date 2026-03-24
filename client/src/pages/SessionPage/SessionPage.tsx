import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';
import { useDebounce } from '../../hooks/useDebounce';
import { useLeanLsp } from '../../hooks/useLeanLsp';
import { fileService } from '../../services/fileService';
import { executionService } from '../../services/executionService';
import { sessionService } from '../../services/sessionService';
import { cpService } from '../../services/cpService';
import { repoService } from '../../services/repoService';
import { leanService } from '../../services/leanService';
import CodeEditor from '../../components/CodeEditor/CodeEditor';
import FileTree from '../../components/FileTree/FileTree';
import MarkdownRenderer from '../../components/MarkdownRenderer/MarkdownRenderer';
import GoalStatePanel from '../../components/GoalStatePanel/GoalStatePanel';
import Badge from '../../components/Badge/Badge';
import { ExecutionRun, SessionFile, TestResult, LakeStatus } from '../../types';
import styles from './SessionPage.module.css';

type NonLeanTab = 'output' | 'notes' | 'tests' | 'problem' | 'repo';
type LeanTab = 'goalState' | 'messages' | 'notes' | 'links';

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
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);
  const [runningTests, setRunningTests] = useState(false);
  const [repoFilePath, setRepoFilePath] = useState<string | null>(null);
  const [repoFileContent, setRepoFileContent] = useState('');
  const [repoFileLoading, setRepoFileLoading] = useState(false);

  // Lean-specific state
  const [building, setBuilding] = useState(false);
  const [lakeStatus, setLakeStatus] = useState<LakeStatus>('initializing');
  const [buildOutput, setBuildOutput] = useState('');

  const isLean = session?.session_type === 'lean';

  // Lean LSP hook
  const leanProjectPath = session?.lean_meta?.absolute_project_path ?? null;
  const lsp = useLeanLsp(id, isLean, leanProjectPath);

  const debouncedNotes = useDebounce(notes, 1500);
  const prevNotesRef = useRef('');
  const fileUriRef = useRef<string | null>(null);

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

        // Send didOpen to LSP for lean sessions
        if (isLean && lsp.initialized && session?.files) {
          const file = session.files.find(f => f.id === activeFileId);
          if (file) {
            const uri = getFileUri(file.filename);
            fileUriRef.current = uri;
            lsp.sendDidOpen(uri, content);
          }
        }
      }).catch(() => {});
    }
  }, [id, activeFileId]);

  // Send didOpen when LSP becomes initialized (if file already loaded)
  useEffect(() => {
    if (isLean && lsp.initialized && fileContent && session?.files && activeFileId) {
      const file = session.files.find(f => f.id === activeFileId);
      if (file) {
        const uri = getFileUri(file.filename);
        fileUriRef.current = uri;
        lsp.sendDidOpen(uri, fileContent);
      }
    }
  }, [lsp.initialized]);

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

  const handleRunTests = async () => {
    if (!session?.problem || runningTests) return;
    setRunningTests(true);
    try {
      const result = await cpService.runTests(session.problem.id);
      setTestResults(result.results);
      setActiveTab('tests');
    } catch (err) {
      console.error(err);
    } finally {
      setRunningTests(false);
    }
  };

  const handleRepoFileSelect = useCallback(async (path: string) => {
    if (!session?.repo) return;
    setRepoFilePath(path);
    setRepoFileLoading(true);
    try {
      const content = await repoService.readFile(session.repo.id, path);
      setRepoFileContent(content);
    } catch {
      setRepoFileContent('Failed to load file.');
    } finally {
      setRepoFileLoading(false);
    }
  }, [session?.repo]);

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
          <Badge label={session.session_type} variant={session.session_type as 'freeform' | 'cp' | 'repo' | 'lean'} />
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
            <button className={styles.buildButton} onClick={handleBuild} disabled={building || lakeStatus === 'initializing'}>
              {building ? 'Building...' : 'Build'}
            </button>
          ) : (
            <>
              {session.session_type === 'cp' && session.problem && (
                <button className={styles.runTestsButton} onClick={handleRunTests} disabled={runningTests}>
                  {runningTests ? 'Testing...' : 'Run Tests'}
                </button>
              )}
              <button className={styles.runButton} onClick={handleExecute} disabled={executing}>
                {executing ? 'Running...' : 'Run'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className={styles.workbench}>
        <div className={styles.editorPane}>
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
          <div className={styles.editorContainer}>
            <CodeEditor
              value={fileContent}
              language={session.language}
              onChange={handleSaveFile}
              onCursorChange={isLean ? handleCursorChange : undefined}
              diagnostics={isLean ? lsp.diagnostics : undefined}
            />
          </div>
        </div>

        <div className={styles.rightPane}>
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
                <button
                  className={`${styles.tab} ${activeTab === 'output' ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab('output')}
                >
                  Output
                </button>
                <button
                  className={`${styles.tab} ${activeTab === 'notes' ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab('notes')}
                >
                  Notes
                </button>
                {session.session_type === 'cp' && (
                  <>
                    <button
                      className={`${styles.tab} ${activeTab === 'tests' ? styles.tabActive : ''}`}
                      onClick={() => setActiveTab('tests')}
                    >
                      Tests
                    </button>
                    <button
                      className={`${styles.tab} ${activeTab === 'problem' ? styles.tabActive : ''}`}
                      onClick={() => setActiveTab('problem')}
                    >
                      Problem
                    </button>
                  </>
                )}
                {session.session_type === 'repo' && (
                  <button
                    className={`${styles.tab} ${activeTab === 'repo' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('repo')}
                  >
                    Repo
                  </button>
                )}
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

            {/* Lean: Links */}
            {activeTab === 'links' && isLean && (
              <div className={styles.linksPane}>
                {session.links && session.links.length > 0 ? (
                  <div className={styles.linksList}>
                    {session.links.map((link, i) => (
                      <div key={i} className={styles.linkItem}>
                        <Badge label={link.app} />
                        <span className={styles.linkRef}>{link.ref_type}: {link.ref_id}</span>
                        {link.label && <span className={styles.linkLabel}>{link.label}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
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

            {/* CP: Tests */}
            {activeTab === 'tests' && session.session_type === 'cp' && (
              <div className={styles.testsPane}>
                {testResults ? (
                  <div className={styles.testResults}>
                    {testResults.map((tr, i) => (
                      <div key={tr.test_case_id} className={`${styles.testResult} ${tr.passed ? styles.testPassed : styles.testFailed}`}>
                        <div className={styles.testHeader}>
                          <span>Test #{i + 1}</span>
                          <Badge label={tr.passed ? 'PASS' : 'FAIL'} variant={tr.passed ? 'success' : 'danger'} />
                          <span className={styles.testTime}>{tr.duration_ms}ms</span>
                        </div>
                        <div className={styles.testDetails}>
                          <div className={styles.testBlock}>
                            <label>Input</label>
                            <pre>{tr.input}</pre>
                          </div>
                          <div className={styles.testBlock}>
                            <label>Expected</label>
                            <pre>{tr.expected_output}</pre>
                          </div>
                          <div className={styles.testBlock}>
                            <label>Actual</label>
                            <pre>{tr.actual_output}</pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : session.test_cases && session.test_cases.length > 0 ? (
                  <div className={styles.testCaseList}>
                    {session.test_cases.map((tc, i) => (
                      <div key={tc.id} className={styles.testCase}>
                        <div className={styles.testCaseHeader}>Test #{i + 1} {tc.is_sample ? '(sample)' : '(custom)'}</div>
                        <div className={styles.testDetails}>
                          <div className={styles.testBlock}><label>Input</label><pre>{tc.input}</pre></div>
                          <div className={styles.testBlock}><label>Expected</label><pre>{tc.expected_output}</pre></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.placeholder}>No test cases. Run Tests to fetch them.</div>
                )}
              </div>
            )}

            {/* CP: Problem */}
            {activeTab === 'problem' && session.problem && (
              <div className={styles.problemPane}>
                <div className={styles.problemInfo}>
                  <div className={styles.problemField}>
                    <label>Judge</label>
                    <span>{session.problem.judge}</span>
                  </div>
                  <div className={styles.problemField}>
                    <label>Problem ID</label>
                    <span>{session.problem.problem_id}</span>
                  </div>
                  {session.problem.problem_url && (
                    <div className={styles.problemField}>
                      <label>URL</label>
                      <a href={session.problem.problem_url} target="_blank" rel="noopener noreferrer">
                        Open in browser
                      </a>
                    </div>
                  )}
                  <div className={styles.problemField}>
                    <label>Verdict</label>
                    <Badge
                      label={session.problem.verdict}
                      variant={session.problem.verdict === 'accepted' ? 'success' : session.problem.verdict === 'unsolved' ? 'default' : 'danger'}
                    />
                  </div>
                  <div className={styles.problemField}>
                    <label>Attempts</label>
                    <span>{session.problem.attempts}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Repo */}
            {activeTab === 'repo' && session.session_type === 'repo' && (
              <div className={styles.repoPane}>
                {session.repo ? (
                  <>
                    <div className={styles.repoMeta}>
                      <div className={styles.repoField}>
                        <label>Repository</label>
                        <span>{session.repo.repo_name}</span>
                      </div>
                      <div className={styles.repoField}>
                        <label>Branch</label>
                        <span>{session.repo.branch}</span>
                      </div>
                      <div className={styles.repoField}>
                        <label>URL</label>
                        <a href={session.repo.repo_url} target="_blank" rel="noopener noreferrer">
                          {session.repo.repo_url}
                        </a>
                      </div>
                    </div>
                    <div className={styles.repoBrowser}>
                      <div className={styles.repoTree}>
                        <FileTree repoId={session.repo.id} onFileSelect={handleRepoFileSelect} />
                      </div>
                      <div className={styles.repoFileViewer}>
                        {repoFileLoading ? (
                          <div className={styles.placeholder}>Loading...</div>
                        ) : repoFilePath ? (
                          <>
                            <div className={styles.repoFileName}>{repoFilePath}</div>
                            <pre className={styles.repoFileContent}>{repoFileContent}</pre>
                          </>
                        ) : (
                          <div className={styles.placeholder}>Select a file to view its contents</div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className={styles.placeholder}>
                    Repository is being cloned. Refresh the page in a moment.
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
