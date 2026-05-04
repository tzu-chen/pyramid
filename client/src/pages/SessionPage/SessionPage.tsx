import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';
import { useDebounce } from '../../hooks/useDebounce';
import { useLeanLsp } from '../../hooks/useLeanLsp';
import { useCppLsp, type CppDocumentSymbol } from '../../hooks/useCppLsp';
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
import CsvViewer from '../../components/CsvViewer/CsvViewer';
import TerminalPane from '../../components/TerminalPane/TerminalPane';
import BuildPanel from '../../components/BuildPanel/BuildPanel';
import OutlinePanel from '../../components/OutlinePanel/OutlinePanel';
import ArtifactBrowser from '../../components/ArtifactBrowser/ArtifactBrowser';
import CompilerExplorerPanel from '../../components/CompilerExplorerPanel/CompilerExplorerPanel';
import type { EditorSelection } from '../../components/CodeEditor/CodeEditor';
import {
  cppBuildService,
  FLAVOR_PRESETS,
  flavorFromId,
  type BuildFlavor,
  type BuildResponse,
  type CompilerDiagnostic,
} from '../../services/cppBuildService';
import { useEditorFontSize } from '../../contexts/EditorFontSizeContext';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { ExecutionRun, SessionFile, SessionLink, LakeStatus, LinkApp, RefType } from '../../types';
import styles from './SessionPage.module.css';

type NonLeanTab = 'output' | 'build' | 'artifacts' | 'outline' | 'asm' | 'claude' | 'notes' | 'links';
type LeanTab = 'goalState' | 'messages' | 'claude' | 'notes' | 'links';

const CMAKE_FLAVOR_KEY = 'pyramid_cmake_flavor';
const CMAKE_TARGET_KEY = 'pyramid_cmake_target';

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

  // Notebook file tree collapse state
  const [notebookTreeCollapsed, setNotebookTreeCollapsed] = useState(false);

  // Resizable split pane
  const { ratio, onDragStart, containerRef } = useResizablePanel({
    storageKey: 'pyramid_panel_ratio',
    defaultRatio: 0.6,
    minRatio: 0.25,
    maxRatio: 0.8,
  });

  // Vertical split inside the right pane (freeform only): tabs/output on top, terminal on bottom
  const {
    ratio: rightVRatio,
    onDragStart: onRightVDragStart,
    containerRef: rightVContainerRef,
  } = useResizablePanel({
    storageKey: 'pyramid_terminal_height_ratio',
    defaultRatio: 0.65,
    minRatio: 0.25,
    maxRatio: 0.85,
    axis: 'y',
  });

  // Lean-specific state
  const [building, setBuilding] = useState(false);
  const [lakeStatus, setLakeStatus] = useState<LakeStatus>('initializing');
  const [buildOutput, setBuildOutput] = useState('');

  const isLean = session?.session_type === 'lean';
  const isNotebook = session?.session_type === 'notebook';
  const isFreeform = session?.session_type === 'freeform';

  // Lean LSP hook
  const leanProjectPath = session?.lean_meta?.absolute_project_path ?? null;
  const lsp = useLeanLsp(id, isLean, leanProjectPath);

  // C++ LSP hook (clangd) — only enabled for freeform C++ sessions
  const isFreeformCpp = isFreeform && session?.language === 'cpp';
  const cppProjectPath = isFreeformCpp ? (session?.absolute_working_dir ?? null) : null;
  const cppLsp = useCppLsp(id, isFreeformCpp, cppProjectPath);

  // CMake-specific state (only relevant for freeform C++ sessions whose dir
  // contains a CMakeLists.txt — populated lazily after session load).
  const [isCmakeProject, setIsCmakeProject] = useState(false);
  const [cmakeFlavorId, setCmakeFlavorId] = useState<string>(() => {
    return localStorage.getItem(CMAKE_FLAVOR_KEY) || 'Debug';
  });
  const [cmakeTarget, setCmakeTarget] = useState<string>(() => {
    return localStorage.getItem(CMAKE_TARGET_KEY) || '';
  });
  const [cmakeTargets, setCmakeTargets] = useState<string[]>([]);
  const [cmakeBuilding, setCmakeBuilding] = useState(false);
  const [cmakeLastBuild, setCmakeLastBuild] = useState<BuildResponse | null>(null);
  const [cmakeBuildError, setCmakeBuildError] = useState<string | null>(null);
  const [cmakeHistoryRefresh, setCmakeHistoryRefresh] = useState(0);
  const onJumpRef = useRef<((line: number, column: number) => void) | null>(null);
  const pendingJumpRef = useRef<{ line: number; column: number } | null>(null);
  const getSelectionRef = useRef<(() => EditorSelection) | null>(null);
  const getSelectionStable = useCallback((): EditorSelection | null => {
    return getSelectionRef.current ? getSelectionRef.current() : null;
  }, []);

  // C++ outline symbols (refreshed on file change + debounced edits)
  const [cppSymbols, setCppSymbols] = useState<CppDocumentSymbol[]>([]);
  const [cppSymbolsLoading, setCppSymbolsLoading] = useState(false);
  const debouncedFileContent = useDebounce(fileContent, 800);

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
    if (session.absolute_working_dir) {
      return `file://${session.absolute_working_dir}/${filename}`;
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
        // If a diagnostic click switched files, fire the pending jump after the
        // editor remounts and ingests the new content.
        const pending = pendingJumpRef.current;
        if (pending) {
          pendingJumpRef.current = null;
          requestAnimationFrame(() => onJumpRef.current?.(pending.line, pending.column));
        }
      }).catch(() => {});
    }
  }, [id, activeFileId]);

  // Reset LSP opened-file tracking on file switch or reconnection
  useEffect(() => {
    lspOpenedFileRef.current = null;
  }, [activeFileId, lsp.initialized, cppLsp.initialized]);

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

  // Same flow for clangd (freeform C++)
  useEffect(() => {
    if (!isFreeformCpp || !cppLsp.initialized || !session?.files || !activeFileId) return;
    const file = session.files.find(f => f.id === activeFileId);
    if (!file) return;
    // Only open .cpp/.cc/.cxx/.h/.hpp files
    const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
    if (!['cpp', 'cc', 'cxx', 'c', 'h', 'hpp', 'hh', 'hxx'].includes(ext)) return;
    const uri = getFileUri(file.filename);
    fileUriRef.current = uri;
    if (lspOpenedFileRef.current !== uri) {
      cppLsp.sendDidOpen(uri, fileContent);
      lspOpenedFileRef.current = uri;
    }
  }, [isFreeformCpp, cppLsp.initialized, fileContent, activeFileId, session?.files, getFileUri, cppLsp.sendDidOpen]);

  // C++ outline: refresh symbols whenever the file content settles or file changes.
  // clangd accepts documentSymbol immediately after didOpen/didChange; the
  // debounced content ensures we don't spam requests on every keystroke.
  useEffect(() => {
    if (!isFreeformCpp || !cppLsp.initialized || !fileUriRef.current) {
      setCppSymbols([]);
      return;
    }
    let cancelled = false;
    setCppSymbolsLoading(true);
    cppLsp
      .requestDocumentSymbols(fileUriRef.current)
      .then((syms) => {
        if (!cancelled) setCppSymbols(syms);
      })
      .catch(() => {
        if (!cancelled) setCppSymbols([]);
      })
      .finally(() => {
        if (!cancelled) setCppSymbolsLoading(false);
      });
    return () => { cancelled = true; };
  }, [isFreeformCpp, cppLsp, activeFileId, debouncedFileContent]);

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
  const cppLspRef = useRef(cppLsp);
  cppLspRef.current = cppLsp;

  const handleSaveFile = useCallback(async (content: string) => {
    if (id && activeFileId) {
      setFileContent(content);
      await fileService.updateContent(id, activeFileId, content).catch(() => {});

      // Send didChange to LSP
      if (isLean && fileUriRef.current) {
        lspRef.current.sendDidChange(fileUriRef.current, content);
      } else if (isFreeformCpp && fileUriRef.current) {
        cppLspRef.current.sendDidChange(fileUriRef.current, content);
      }
    }
  }, [id, activeFileId, isLean, isFreeformCpp]);

  const handleCursorChange = useCallback((position: { line: number; character: number }) => {
    if (isLean && fileUriRef.current) {
      lspRef.current.requestGoalState(fileUriRef.current, position.line, position.character);
    }
  }, [isLean]);

  // Detect CMake project on session load. Re-runs whenever the session's file
  // list changes — adding/removing CMakeLists.txt should toggle the UI.
  useEffect(() => {
    if (!id || !isFreeformCpp) {
      setIsCmakeProject(false);
      setCmakeTargets([]);
      return;
    }
    cppBuildService.status(id)
      .then((s) => setIsCmakeProject(s.is_cmake_project))
      .catch(() => setIsCmakeProject(false));
  }, [id, isFreeformCpp, session?.files]);

  // Persist flavor + target choices.
  useEffect(() => { localStorage.setItem(CMAKE_FLAVOR_KEY, cmakeFlavorId); }, [cmakeFlavorId]);
  useEffect(() => {
    if (cmakeTarget) localStorage.setItem(CMAKE_TARGET_KEY, cmakeTarget);
    else localStorage.removeItem(CMAKE_TARGET_KEY);
  }, [cmakeTarget]);

  const refreshCmakeTargets = useCallback(async (flavor: BuildFlavor) => {
    if (!id || !isCmakeProject) return;
    try {
      const { binaries } = await cppBuildService.binaries(id, flavor);
      setCmakeTargets(binaries.map(b => b.name));
    } catch {
      setCmakeTargets([]);
    }
  }, [id, isCmakeProject]);

  // Refresh target list when flavor changes or after a successful build.
  useEffect(() => {
    if (isCmakeProject) refreshCmakeTargets(flavorFromId(cmakeFlavorId));
  }, [isCmakeProject, cmakeFlavorId, refreshCmakeTargets]);

  const applyBuildResponse = useCallback((resp: BuildResponse) => {
    setCmakeLastBuild(resp);
    setCmakeHistoryRefresh(n => n + 1);
    if (resp.binary_paths.length) {
      const names = resp.binary_paths.map(p => p.split('/').pop() || p);
      setCmakeTargets(names);
      // Auto-select the only target if user hasn't picked one yet.
      if (!cmakeTarget && names.length === 1) setCmakeTarget(names[0]);
    }
  }, [cmakeTarget]);

  const handleCmakeBuild = useCallback(async () => {
    if (!id || cmakeBuilding) return;
    setCmakeBuilding(true);
    setCmakeBuildError(null);
    setActiveTab('build');
    try {
      const flavor = flavorFromId(cmakeFlavorId);
      const resp = await cppBuildService.build(id, flavor, cmakeTarget ? { target: cmakeTarget } : undefined);
      applyBuildResponse(resp);
    } catch (err) {
      setCmakeBuildError((err as Error).message);
    } finally {
      setCmakeBuilding(false);
    }
  }, [id, cmakeBuilding, cmakeFlavorId, cmakeTarget, applyBuildResponse]);

  const handleExecute = async () => {
    if (!id || executing) return;
    setExecuting(true);
    try {
      if (isCmakeProject) {
        const flavor = flavorFromId(cmakeFlavorId);
        const result = await executionService.execute(id, {
          file_id: activeFileId ?? undefined,
          flavor,
          target: cmakeTarget || undefined,
        });
        if (result.kind === 'ran') {
          applyBuildResponse({
            build_id: result.build_id,
            flavor: result.flavor,
            success: true,
            duration_ms: result.build_duration_ms,
            diagnostics: result.diagnostics,
            log: result.build_log,
            binary_paths: [result.binary_path],
          });
          setRuns(prev => [result.run, ...prev]);
          setActiveTab('output');
        } else if (result.kind === 'build_failed' || result.kind === 'no_binary') {
          applyBuildResponse({
            build_id: result.build_id,
            flavor: result.flavor,
            success: false,
            duration_ms: result.duration_ms,
            diagnostics: result.diagnostics,
            log: result.log,
            binary_paths: [],
          });
          setActiveTab('build');
        }
      } else {
        const run = await executionService.execute(id, activeFileId ? { file_id: activeFileId } : undefined);
        // Single-file path returns a bare ExecutionRun (kind=undefined).
        if ((run as ExecutionRun).id) {
          setRuns(prev => [run as ExecutionRun, ...prev]);
        }
        setActiveTab('output');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setExecuting(false);
    }
  };

  const handleOutlineSelect = useCallback((line: number, character: number) => {
    // LSP positions are 0-indexed; onJumpRef expects 1-indexed.
    onJumpRef.current?.(line + 1, character + 1);
  }, []);

  const handleDiagnosticClick = useCallback((d: CompilerDiagnostic) => {
    if (!session?.files) return;
    const target = session.files.find(f => f.filename === d.file)
      ?? session.files.find(f => f.filename.endsWith('/' + d.file))
      ?? session.files.find(f => d.file.endsWith('/' + f.filename));
    if (target && target.id !== activeFileId) {
      pendingJumpRef.current = { line: d.line, column: d.column };
      setActiveFileId(target.id);
    } else {
      onJumpRef.current?.(d.line, d.column);
    }
  }, [session?.files, activeFileId]);

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
      } else if (isFreeformCpp && fileUriRef.current) {
        cppLspRef.current.sendDidChange(fileUriRef.current, code);
      }
    }
  }, [id, activeFileId, isLean, isFreeformCpp, isNotebook]);

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

  // C++ LSP: completion + hover sources for the editor
  const cppExternalCompletion = useCallback(async (code: string, cursorPos: number) => {
    if (!isFreeformCpp || !fileUriRef.current) return null;
    // Compute line/character from absolute cursor position
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < cursorPos; i++) {
      if (code.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
    }
    const character = cursorPos - lineStart;
    const items = await cppLspRef.current.requestCompletion(fileUriRef.current, line, character);
    if (!items || items.length === 0) return null;
    // Determine replacement range: word characters before cursor
    let from = cursorPos;
    while (from > 0) {
      const c = code.charCodeAt(from - 1);
      const isWord = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
      if (!isWord) break;
      from--;
    }
    return {
      from,
      to: cursorPos,
      matches: items.slice(0, 100).map((it) => ({
        label: it.insertText || it.label,
        type: 'variable',
        detail: it.detail,
      })),
    };
  }, [isFreeformCpp]);

  const cppExternalHover = useCallback(async (line: number, character: number) => {
    if (!isFreeformCpp || !fileUriRef.current) return null;
    return await cppLspRef.current.requestHover(fileUriRef.current, line, character);
  }, [isFreeformCpp]);

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (error) return <div className={styles.error}>Error: {error}</div>;
  if (!session) return <div className={styles.error}>Session not found</div>;

  const latestRun = runs[0];

  const activeFile = activeFileId ? session.files.find(f => f.id === activeFileId) : null;
  const activeFileExt = activeFile?.filename.split('.').pop()?.toLowerCase() ?? '';

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
          {isCmakeProject && (
            <Badge label={`cmake: ${cmakeFlavorId}`} variant="default" />
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
              {isCmakeProject && (
                <>
                  <select
                    className={styles.flavorSelect}
                    value={cmakeFlavorId}
                    onChange={e => setCmakeFlavorId(e.target.value)}
                    title="Build flavor"
                  >
                    {FLAVOR_PRESETS.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                  <select
                    className={styles.flavorSelect}
                    value={cmakeTarget}
                    onChange={e => setCmakeTarget(e.target.value)}
                    title="Run target"
                  >
                    <option value="">(auto)</option>
                    {cmakeTargets.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <button
                    className={styles.buildButton}
                    onClick={handleCmakeBuild}
                    disabled={cmakeBuilding}
                  >
                    {cmakeBuilding ? 'Building...' : 'Build'}
                  </button>
                </>
              )}
              <button className={styles.runButton} onClick={handleExecute} disabled={executing}>
                {executing ? (isCmakeProject ? 'Building/Running...' : 'Running...') : 'Run'}
              </button>
              {((cmakeLastBuild && !cmakeLastBuild.success) || (latestRun && (latestRun.exit_code !== 0 || latestRun.stderr))) && (
                <button className={styles.askClaudeButton} onClick={handleAskClaude}>Ask Claude</button>
              )}
            </>
          )}
        </div>
      </div>

      <div className={styles.workbench} ref={containerRef}>
        <div className={styles.editorPane} style={{ flexBasis: `${ratio * 100}%` }}>
          {isNotebook && activeFileId ? (
            <div className={styles.editorWithTree}>
              {!notebookTreeCollapsed && (
                <div className={styles.fileTreePanel}>
                  <div className={styles.fileTreeHeader}>
                    <button
                      className={styles.fileTreeToggle}
                      onClick={() => setNotebookTreeCollapsed(true)}
                      title="Collapse file browser"
                    >
                      ‹
                    </button>
                  </div>
                  <FileTree
                    sessionId={id!}
                    files={session.files}
                    activeFileId={activeFileId}
                    onSelectFile={setActiveFileId}
                    onFilesChanged={refresh}
                    sessionLanguage={session.language}
                  />
                </div>
              )}
              {notebookTreeCollapsed && (
                <button
                  className={styles.fileTreeExpandBtn}
                  onClick={() => setNotebookTreeCollapsed(false)}
                  title="Show file browser"
                >
                  ›
                </button>
              )}
              <div className={styles.editorContainer}>
                {activeFileExt === 'ipynb' ? (
                  <NotebookEditor sessionId={id!} fileId={activeFileId} fontSize={fontSize} />
                ) : activeFileExt === 'csv' ? (
                  <CsvViewer sessionId={id!} fileId={activeFileId} />
                ) : (
                  <CodeEditor
                    value={fileContent}
                    language={activeFile?.language || ''}
                    onChange={handleSaveFile}
                    fontSize={fontSize}
                    onInsertRef={insertRef}
                  />
                )}
              </div>
            </div>
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
                  diagnostics={isFreeformCpp ? cppLsp.diagnostics : undefined}
                  externalCompletion={isFreeformCpp ? cppExternalCompletion : undefined}
                  externalHover={isFreeformCpp ? cppExternalHover : undefined}
                  fontSize={fontSize}
                  onInsertRef={insertRef}
                  onJumpRef={onJumpRef}
                  onGetSelectionRef={isFreeformCpp ? getSelectionRef : undefined}
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
        <div
          className={styles.rightPane}
          ref={isFreeform ? rightVContainerRef : undefined}
          style={{ flexBasis: `${(1 - ratio) * 100}%`, '--panel-font-size': `${fontSize}px` } as React.CSSProperties}
        >
          <div
            className={styles.rightPaneTop}
            style={isFreeform ? { flexBasis: `${rightVRatio * 100}%`, flexGrow: 0, flexShrink: 0 } : undefined}
          >
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
                {isCmakeProject && (
                  <button
                    className={`${styles.tab} ${activeTab === 'build' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('build')}
                  >
                    Build
                    {cmakeLastBuild && !cmakeLastBuild.success && (
                      <span className={styles.tabBadge}>!</span>
                    )}
                  </button>
                )}
                {isCmakeProject && (
                  <button
                    className={`${styles.tab} ${activeTab === 'artifacts' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('artifacts')}
                  >
                    Artifacts
                  </button>
                )}
                {isFreeformCpp && (
                  <button
                    className={`${styles.tab} ${activeTab === 'outline' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('outline')}
                  >
                    Outline
                  </button>
                )}
                {isFreeformCpp && (
                  <button
                    className={`${styles.tab} ${activeTab === 'asm' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('asm')}
                  >
                    Asm
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

            {/* C++: Outline (clangd documentSymbol) */}
            {activeTab === 'outline' && isFreeformCpp && (
              <OutlinePanel
                symbols={cppSymbols}
                loading={cppSymbolsLoading}
                initialized={cppLsp.initialized}
                onSelect={handleOutlineSelect}
              />
            )}

            {/* C++: Compiler Explorer (godbolt.org) */}
            {activeTab === 'asm' && isFreeformCpp && (
              <CompilerExplorerPanel
                fileName={session.files.find(f => f.id === activeFileId)?.filename || ''}
                fileContent={fileContent}
                getSelection={getSelectionStable}
              />
            )}

            {/* CMake: Build panel */}
            {activeTab === 'build' && isCmakeProject && (
              <div className={styles.buildTabPane}>
                {cmakeBuildError && (
                  <div className={styles.buildError}>{cmakeBuildError}</div>
                )}
                <BuildPanel
                  sessionId={id!}
                  latest={cmakeLastBuild}
                  refreshKey={cmakeHistoryRefresh}
                  onDiagnosticClick={handleDiagnosticClick}
                />
              </div>
            )}

            {/* CMake: Artifact browser */}
            {activeTab === 'artifacts' && isCmakeProject && (
              <ArtifactBrowser sessionId={id!} refreshKey={cmakeHistoryRefresh} />
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
          {isFreeform && (
            <>
              <div
                className={styles.verticalDivider}
                onMouseDown={onRightVDragStart}
                onTouchStart={onRightVDragStart}
              />
              <div
                className={styles.terminalSection}
                style={{ flexBasis: `${(1 - rightVRatio) * 100}%` }}
              >
                <TerminalPane sessionId={id!} visible={true} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default SessionPage;
