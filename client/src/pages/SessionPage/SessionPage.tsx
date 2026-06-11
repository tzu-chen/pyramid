import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';
import { useFullscreen } from '../../contexts/FullscreenContext';
import { useDebounce } from '../../hooks/useDebounce';
import { useLeanLsp } from '../../hooks/useLeanLsp';
import { useCppLsp, type CppDocumentSymbol } from '../../hooks/useCppLsp';
import { useOcamlLsp, type OcamlDocumentSymbol } from '../../hooks/useOcamlLsp';
import { useDapSession, type DapStackFrame } from '../../hooks/useDapSession';
import { fileService } from '../../services/fileService';
import { executionService } from '../../services/executionService';
import { sessionService } from '../../services/sessionService';
import { leanService } from '../../services/leanService';
import { scribeService, type ScribeNode, type ScribeBook } from '../../services/claudeService';
import CodeEditor from '../../components/CodeEditor/CodeEditor';
import ClaudePanel from '../../components/ClaudePanel/ClaudePanel';
import MarkdownRenderer from '../../components/MarkdownRenderer/MarkdownRenderer';
import GoalStatePanel from '../../components/GoalStatePanel/GoalStatePanel';
import SymbolPalette from '../../components/SymbolPalette/SymbolPalette';
import Badge from '../../components/Badge/Badge';
import FileTree from '../../components/FileTree/FileTree';
import FileTabs from '../../components/FileTabs/FileTabs';
import WelcomeScreen from '../../components/WelcomeScreen/WelcomeScreen';
import NotebookEditor from '../../components/NotebookEditor/NotebookEditor';
import VariableInspector from '../../components/VariableInspector/VariableInspector';
import CsvViewer from '../../components/CsvViewer/CsvViewer';
import TerminalPane from '../../components/TerminalPane/TerminalPane';
import BuildPanel from '../../components/BuildPanel/BuildPanel';
import OutlinePanel from '../../components/OutlinePanel/OutlinePanel';
import ArtifactBrowser from '../../components/ArtifactBrowser/ArtifactBrowser';
import CompilerExplorerPanel from '../../components/CompilerExplorerPanel/CompilerExplorerPanel';
import DebugPanel from '../../components/DebugPanel/DebugPanel';
import ReferencePanel, { getReferenceSources } from '../../components/ReferencePanel/ReferencePanel';
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/Icons/Icons';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import { api } from '../../services/api';
import type { EditorSelection } from '../../components/CodeEditor/CodeEditor';
import {
  cppBuildService,
  FLAVOR_PRESETS,
  flavorFromId,
  type BuildFlavor,
  type BuildResponse,
  type CompilerDiagnostic,
} from '../../services/cppBuildService';
import {
  duneBuildService,
  DUNE_PROFILE_PRESETS,
  duneFlavorFromId,
  type DuneProfile,
} from '../../services/duneBuildService';
import { useEditorFontSize } from '../../contexts/EditorFontSizeContext';
import { editorStorage } from '../../services/editorStorage';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { ExecutionRun, SessionLink, LakeStatus, LinkApp, RefType, isFreeformType } from '../../types';
import { formatBytes } from '../../utils/format';
import styles from './SessionPage.module.css';

type NonLeanTab = 'output' | 'build' | 'artifacts' | 'outline' | 'asm' | 'variables' | 'debug' | 'reference' | 'claude' | 'notes' | 'links';
type LeanTab = 'goalState' | 'messages' | 'reference' | 'claude' | 'notes' | 'links';

const CMAKE_FLAVOR_KEY = 'pyramid_cmake_flavor';
const CMAKE_TARGET_KEY = 'pyramid_cmake_target';
const DUNE_PROFILE_KEY = 'pyramid_dune_profile';
const DUNE_TARGET_KEY = 'pyramid_dune_target';
const PANEL_COLLAPSED_KEY = 'pyramid_panel_collapsed';

// Files clangd should syntax-check. Anything else (CMakeLists.txt, *.txt,
// *.md, ...) must not be opened in clangd or surface clangd diagnostics, even
// if it lives in a C++ session.
const CPP_SOURCE_EXTS = new Set(['cpp', 'cc', 'cxx', 'c', 'h', 'hpp', 'hh', 'hxx', 'ipp', 'tpp', 'inl']);

// Files ocamllsp should syntax-check. Anything else (dune, dune-project, *.txt,
// *.md, ...) must not be opened in ocamllsp.
const OCAML_SOURCE_EXTS = new Set(['ml', 'mli']);

function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const { session, loading, error, refresh } = useSession(id);
  const { fullscreen } = useFullscreen();

  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [openFileIds, setOpenFileIds] = useState<string[]>([]);
  const [fileContent, setFileContent] = useState('');
  const [activeTab, setActiveTab] = useState<NonLeanTab | LeanTab>('output');
  const [notes, setNotes] = useState('');
  const [notesEditing, setNotesEditing] = useState(false);
  const [runs, setRuns] = useState<ExecutionRun[]>([]);
  const [executing, setExecuting] = useState(false);
  const [autoErrorMode, setAutoErrorMode] = useState(false);
  const claudePromptFocusRef = useRef<(() => void) | null>(null);

  // Link management state
  const [linkAddMode, setLinkAddMode] = useState<'scribe' | 'scribe-book' | 'navigate' | 'granary' | 'monolith' | null>(null);
  const [linkScribeSearch, setLinkScribeSearch] = useState('');
  const [linkScribeResults, setLinkScribeResults] = useState<ScribeNode[]>([]);
  const [linkScribeSearching, setLinkScribeSearching] = useState(false);
  const [linkBookSearch, setLinkBookSearch] = useState('');
  const [linkBookResults, setLinkBookResults] = useState<ScribeBook[]>([]);
  const [linkBookSearching, setLinkBookSearching] = useState(false);
  const [linkBookPage, setLinkBookPage] = useState('');
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

  // Hide/show the right side panel (tabs + terminal). Persisted so it sticks
  // across reloads, mirroring the sidebar collapse in Layout.
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(
    () => localStorage.getItem(PANEL_COLLAPSED_KEY) === '1',
  );
  useEffect(() => {
    localStorage.setItem(PANEL_COLLAPSED_KEY, panelCollapsed ? '1' : '0');
  }, [panelCollapsed]);
  useKeyboardShortcut('togglePanel', useCallback(() => setPanelCollapsed(c => !c), []));

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
  const isFreeform = !!session && isFreeformType(session.session_type);

  // User-controlled suspend toggle. When true, all WebSockets for this session
  // (Lean LSP, clangd, notebook kernel, terminal PTYs) are torn down; the
  // server-side idle timer reaps the underlying processes within ~5 minutes.
  // Distinct from the visibility-based auto-suspend in usePageHidden.
  const [suspended, setSuspended] = useState(false);

  // Lean LSP hook
  const leanProjectPath = session?.lean_meta?.absolute_project_path ?? null;
  const lsp = useLeanLsp(id, isLean && !suspended, leanProjectPath);

  // C++ LSP hook (clangd) — only enabled for freeform C++ sessions
  const isFreeformCpp = isFreeform && session?.language === 'cpp';
  const cppProjectPath = isFreeformCpp ? (session?.absolute_working_dir ?? null) : null;
  const cppLsp = useCppLsp(id, isFreeformCpp && !suspended, cppProjectPath);

  // OCaml LSP hook (ocamllsp) — only enabled for freeform OCaml sessions
  const isFreeformOcaml = isFreeform && session?.language === 'ocaml';
  const ocamlProjectPath = isFreeformOcaml ? (session?.absolute_working_dir ?? null) : null;
  const ocamlLsp = useOcamlLsp(id, isFreeformOcaml && !suspended, ocamlProjectPath);

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

  // Dune-specific state (only relevant for freeform OCaml sessions whose dir
  // contains a dune-project — populated lazily after session load).
  const [isDuneProject, setIsDuneProject] = useState(false);
  const [duneProfileId, setDuneProfileId] = useState<DuneProfile>(() => {
    return (localStorage.getItem(DUNE_PROFILE_KEY) as DuneProfile) || 'dev';
  });
  const [duneTarget, setDuneTarget] = useState<string>(() => {
    return localStorage.getItem(DUNE_TARGET_KEY) || '';
  });
  const [duneTargets, setDuneTargets] = useState<string[]>([]);
  const [duneBuilding, setDuneBuilding] = useState(false);
  const [duneLastBuild, setDuneLastBuild] = useState<BuildResponse | null>(null);
  const [duneBuildError, setDuneBuildError] = useState<string | null>(null);
  const [duneHistoryRefresh, setDuneHistoryRefresh] = useState(0);

  // Debugger state. Only meaningful when isFreeformOcaml && isDuneProject.
  // Breakpoints are session-scoped, in-memory (file path → 1-indexed lines).
  const [breakpoints, setBreakpoints] = useState<Map<string, number[]>>(new Map());
  const [debugTargets, setDebugTargets] = useState<string[]>([]);
  const [selectedDebugTarget, setSelectedDebugTarget] = useState<string>('');
  // Absolute path of each .bc target, keyed by name — needed for the launch arg.
  const [debugTargetPaths, setDebugTargetPaths] = useState<Map<string, string>>(new Map());
  const onJumpRef = useRef<((line: number, column: number) => void) | null>(null);
  const pendingJumpRef = useRef<{ line: number; column: number } | null>(null);
  const getSelectionRef = useRef<(() => EditorSelection) | null>(null);
  const getSelectionStable = useCallback((): EditorSelection | null => {
    return getSelectionRef.current ? getSelectionRef.current() : null;
  }, []);

  // asm ↔ source hover-sync wiring for CompilerExplorerPanel.
  const setHighlightedLineRef = useRef<((line: number | null) => void) | null>(null);
  const setHighlightedSourceLineStable = useCallback((line: number | null) => {
    setHighlightedLineRef.current?.(line);
  }, []);
  const [editorCursorLine, setEditorCursorLine] = useState<number | null>(null);

  // C++ outline symbols (refreshed on file change + debounced edits)
  const [cppSymbols, setCppSymbols] = useState<CppDocumentSymbol[]>([]);
  const [cppSymbolsLoading, setCppSymbolsLoading] = useState(false);
  // OCaml outline symbols (same shape, separate state to keep tabs simple)
  const [ocamlSymbols, setOcamlSymbols] = useState<OcamlDocumentSymbol[]>([]);
  const [ocamlSymbolsLoading, setOcamlSymbolsLoading] = useState(false);
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

  // Restore session state (notes, runs, default tab, and open file tabs) when
  // the session loads or we navigate between sessions.
  useEffect(() => {
    if (!session) return;
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

    // Reopen the tabs that were open last time, dropping any whose file has
    // since been deleted. On first visit (no persisted record) fall back to the
    // primary file; Lean has no file tree, so it auto-opens all files. An empty
    // persisted record is honored — the session reopens to the welcome screen.
    const files = session.files ?? [];
    const existing = new Set(files.map(f => f.id));
    const persisted = editorStorage.getOpenFiles(session.id);
    if (persisted) {
      const restoredOpen = persisted.openFileIds.filter(fid => existing.has(fid));
      const restoredActive =
        persisted.activeFileId && existing.has(persisted.activeFileId)
          ? persisted.activeFileId
          : (restoredOpen[0] ?? null);
      setOpenFileIds(restoredOpen);
      setActiveFileId(restoredActive);
    } else if (files.length > 0) {
      const primary = files.find(f => f.is_primary) || files[0];
      setActiveFileId(primary.id);
      setOpenFileIds(session.session_type === 'lean' ? files.map(f => f.id) : [primary.id]);
    } else {
      setOpenFileIds([]);
      setActiveFileId(null);
    }
  }, [session?.id]);

  // Persist open tabs + active tab per session so reopening restores them.
  // Skipped on the first render after a session loads: openFileIds/activeFileId
  // still reflect the previous session until the restore effect above flushes,
  // and persisting then would clobber this session's saved state.
  const persistedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!session?.id) return;
    if (persistedSessionRef.current !== session.id) {
      persistedSessionRef.current = session.id;
      return;
    }
    editorStorage.saveOpenFiles(session.id, { openFileIds, activeFileId });
  }, [session?.id, openFileIds, activeFileId]);

  // Open a file as a tab. If already open, just activate it; otherwise append.
  const openFile = useCallback((fileId: string) => {
    setOpenFileIds((prev) => (prev.includes(fileId) ? prev : [...prev, fileId]));
    setActiveFileId(fileId);
  }, []);

  // Close a tab. If it was the active tab, fall back to the neighbor.
  const closeFile = useCallback((fileId: string) => {
    setOpenFileIds((prev) => {
      const idx = prev.indexOf(fileId);
      if (idx === -1) return prev;
      const next = prev.filter((id) => id !== fileId);
      setActiveFileId((curr) => {
        if (curr !== fileId) return curr;
        if (next.length === 0) return null;
        return next[Math.min(idx, next.length - 1)];
      });
      return next;
    });
  }, []);

  // Drop tabs whose files no longer exist (e.g. after delete).
  useEffect(() => {
    if (!session?.files) return;
    const existing = new Set(session.files.map((f) => f.id));
    setOpenFileIds((prev) => {
      const filtered = prev.filter((id) => existing.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
    setActiveFileId((curr) => (curr && !existing.has(curr) ? null : curr));
  }, [session?.files]);

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
    } else {
      // No file open (all tabs closed) — clear stale content so panels that read
      // it (Claude, Asm) don't reference a file that's no longer showing.
      setFileContent('');
    }
  }, [id, activeFileId]);

  // Reset LSP opened-file tracking on file switch or reconnection. fileUriRef
  // is cleared too so that didChange/outline/completion don't keep targeting
  // the previously opened file when the new active file isn't an LSP file.
  useEffect(() => {
    lspOpenedFileRef.current = null;
    fileUriRef.current = null;
    setEditorCursorLine(null);
  }, [activeFileId, lsp.initialized, cppLsp.initialized, ocamlLsp.initialized]);

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

  // Same flow for clangd (freeform C++). Only C/C++ source files are opened
  // in clangd; for anything else (CMakeLists.txt, *.txt, ...) the URI is
  // explicitly cleared so stray didChange / completion / hover requests can't
  // be sent against the previously opened source file.
  useEffect(() => {
    if (!isFreeformCpp || !cppLsp.initialized || !session?.files || !activeFileId) return;
    const file = session.files.find(f => f.id === activeFileId);
    if (!file) return;
    const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
    if (!CPP_SOURCE_EXTS.has(ext)) {
      fileUriRef.current = null;
      lspOpenedFileRef.current = null;
      return;
    }
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

  // OCaml didOpen flow — only *.ml / *.mli files go to ocamllsp.
  useEffect(() => {
    if (!isFreeformOcaml || !ocamlLsp.initialized || !session?.files || !activeFileId) return;
    const file = session.files.find(f => f.id === activeFileId);
    if (!file) return;
    const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
    if (!OCAML_SOURCE_EXTS.has(ext)) {
      fileUriRef.current = null;
      lspOpenedFileRef.current = null;
      return;
    }
    const uri = getFileUri(file.filename);
    fileUriRef.current = uri;
    if (lspOpenedFileRef.current !== uri) {
      ocamlLsp.sendDidOpen(uri, fileContent);
      lspOpenedFileRef.current = uri;
    }
  }, [isFreeformOcaml, ocamlLsp.initialized, fileContent, activeFileId, session?.files, getFileUri, ocamlLsp.sendDidOpen]);

  // OCaml outline: same pattern as C++.
  useEffect(() => {
    if (!isFreeformOcaml || !ocamlLsp.initialized || !fileUriRef.current) {
      setOcamlSymbols([]);
      return;
    }
    let cancelled = false;
    setOcamlSymbolsLoading(true);
    ocamlLsp
      .requestDocumentSymbols(fileUriRef.current)
      .then((syms) => {
        if (!cancelled) setOcamlSymbols(syms);
      })
      .catch(() => {
        if (!cancelled) setOcamlSymbols([]);
      })
      .finally(() => {
        if (!cancelled) setOcamlSymbolsLoading(false);
      });
    return () => { cancelled = true; };
  }, [isFreeformOcaml, ocamlLsp, activeFileId, debouncedFileContent]);

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
  const ocamlLspRef = useRef(ocamlLsp);
  ocamlLspRef.current = ocamlLsp;

  const handleSaveFile = useCallback(async (content: string) => {
    if (id && activeFileId) {
      setFileContent(content);
      await fileService.updateContent(id, activeFileId, content).catch(() => {});

      // Send didChange to LSP
      if (isLean && fileUriRef.current) {
        lspRef.current.sendDidChange(fileUriRef.current, content);
      } else if (isFreeformCpp && fileUriRef.current) {
        cppLspRef.current.sendDidChange(fileUriRef.current, content);
      } else if (isFreeformOcaml && fileUriRef.current) {
        ocamlLspRef.current.sendDidChange(fileUriRef.current, content);
      }
    }
  }, [id, activeFileId, isLean, isFreeformCpp, isFreeformOcaml]);

  const handleCursorChange = useCallback((position: { line: number; character: number }) => {
    if (isLean && fileUriRef.current) {
      lspRef.current.requestGoalState(fileUriRef.current, position.line, position.character);
    }
    // 1-indexed line for asm-panel reverse highlight (CodeEditor reports 0-indexed).
    setEditorCursorLine(position.line + 1);
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
    // Re-read targets from the CMake File API: declared targets in CMakeLists.txt
    // appear here even if --target left them unbuilt this round.
    refreshCmakeTargets(flavorFromId(cmakeFlavorId));
    if (!cmakeTarget && resp.binary_paths.length === 1) {
      const name = resp.binary_paths[0].split('/').pop() || resp.binary_paths[0];
      setCmakeTarget(name);
    }
  }, [cmakeTarget, cmakeFlavorId, refreshCmakeTargets]);

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

  // ─── Dune (OCaml) build pipeline ──────────────────────────────────────────

  useEffect(() => {
    if (!id || !isFreeformOcaml) {
      setIsDuneProject(false);
      setDuneTargets([]);
      return;
    }
    duneBuildService.status(id)
      .then((s) => setIsDuneProject(s.is_dune_project))
      .catch(() => setIsDuneProject(false));
  }, [id, isFreeformOcaml, session?.files]);

  useEffect(() => { localStorage.setItem(DUNE_PROFILE_KEY, duneProfileId); }, [duneProfileId]);
  useEffect(() => {
    if (duneTarget) localStorage.setItem(DUNE_TARGET_KEY, duneTarget);
    else localStorage.removeItem(DUNE_TARGET_KEY);
  }, [duneTarget]);

  const refreshDuneTargets = useCallback(async (profile: DuneProfile) => {
    if (!id || !isDuneProject) return;
    try {
      const { binaries } = await duneBuildService.binaries(id, { profile });
      setDuneTargets(binaries.map(b => b.name));
    } catch {
      setDuneTargets([]);
    }
  }, [id, isDuneProject]);

  useEffect(() => {
    if (isDuneProject) refreshDuneTargets(duneProfileId);
  }, [isDuneProject, duneProfileId, refreshDuneTargets]);

  const applyDuneBuildResponse = useCallback((resp: BuildResponse) => {
    setDuneLastBuild(resp);
    setDuneHistoryRefresh(n => n + 1);
    refreshDuneTargets(duneProfileId);
    if (!duneTarget && resp.binary_paths.length === 1) {
      const name = (resp.binary_paths[0].split('/').pop() || '').replace(/\.exe$/, '');
      if (name) setDuneTarget(name);
    }
  }, [duneTarget, duneProfileId, refreshDuneTargets]);

  const handleDuneBuild = useCallback(async () => {
    if (!id || duneBuilding) return;
    setDuneBuilding(true);
    setDuneBuildError(null);
    setActiveTab('build');
    try {
      const flavor = duneFlavorFromId(duneProfileId);
      const resp = await duneBuildService.build(id, flavor, duneTarget ? { target: duneTarget } : undefined);
      applyDuneBuildResponse(resp);
    } catch (err) {
      setDuneBuildError((err as Error).message);
    } finally {
      setDuneBuilding(false);
    }
  }, [id, duneBuilding, duneProfileId, duneTarget, applyDuneBuildResponse]);

  // ─── Debugger (earlybird DAP) ─────────────────────────────────────────────

  const debugEnabled = !!isFreeformOcaml && isDuneProject && !suspended;
  const [debugStoppedLocation, setDebugStoppedLocation] = useState<{ file: string; line: number } | null>(null);

  const dap = useDapSession({
    sessionId: id,
    enabled: debugEnabled,
    breakpoints,
    onStopped: (info) => {
      if (info.location?.file && typeof info.location.line === 'number') {
        setDebugStoppedLocation({ file: info.location.file, line: info.location.line });
      }
    },
    onTerminated: () => {
      setDebugStoppedLocation(null);
    },
  });

  // Refresh available bytecode targets whenever the dune profile changes or a
  // build completes — both are signals that .bc files may have appeared.
  useEffect(() => {
    if (!id || !debugEnabled || !isDuneProject) {
      setDebugTargets([]);
      setDebugTargetPaths(new Map());
      return;
    }
    let cancelled = false;
    api.get<{ profile: string; binaries: Array<{ name: string; path: string }> }>(
      `/sessions/${id}/debug/binaries?profile=${duneProfileId}`
    ).then((resp) => {
      if (cancelled) return;
      const names = resp.binaries.map((b) => b.name);
      setDebugTargets(names);
      setDebugTargetPaths(new Map(resp.binaries.map((b) => [b.name, b.path] as const)));
      // Auto-pick: prefer current dune run target if it has a .bc, else first.
      if (!selectedDebugTarget || !names.includes(selectedDebugTarget)) {
        const pick = (duneTarget && names.includes(duneTarget)) ? duneTarget : (names[0] ?? '');
        setSelectedDebugTarget(pick);
      }
    }).catch(() => {
      if (!cancelled) {
        setDebugTargets([]);
        setDebugTargetPaths(new Map());
      }
    });
    return () => { cancelled = true; };
  }, [id, debugEnabled, isDuneProject, duneProfileId, duneHistoryRefresh, duneTarget, selectedDebugTarget]);

  const handleDebugStart = useCallback(async (stopOnEntry: boolean) => {
    if (!selectedDebugTarget) return;
    const program = debugTargetPaths.get(selectedDebugTarget);
    if (!program) return;
    setActiveTab('debug');
    setDebugStoppedLocation(null);
    await dap.launch(program, [], session?.absolute_working_dir ?? undefined, stopOnEntry);
  }, [dap, selectedDebugTarget, debugTargetPaths, session?.absolute_working_dir]);

  // Toggle a breakpoint on the currently active file. Lines are 1-indexed.
  const handleBreakpointToggle = useCallback((line: number) => {
    if (!session || !activeFileId) return;
    const file = session.files.find((f) => f.id === activeFileId);
    if (!file) return;
    const absPath = session.absolute_working_dir
      ? `${session.absolute_working_dir}/${file.filename}`
      : file.filename;
    setBreakpoints((prev) => {
      const next = new Map(prev);
      const existing = next.get(absPath) ?? [];
      const has = existing.includes(line);
      const updated = has ? existing.filter((l) => l !== line) : [...existing, line].sort((a, b) => a - b);
      if (updated.length === 0) next.delete(absPath);
      else next.set(absPath, updated);
      return next;
    });
  }, [session, activeFileId]);

  // Click a stack frame → switch to its file (if present in the session) and
  // jump to the line. Best-effort: matches by basename if absolute paths differ.
  const handleDebugFrameClick = useCallback((frame: DapStackFrame) => {
    if (!session?.files || !frame.source) return;
    const wantedPath = frame.source.path ?? '';
    const wantedName = frame.source.name ?? wantedPath.split('/').pop() ?? '';
    const target = session.files.find((f) => {
      const abs = session.absolute_working_dir ? `${session.absolute_working_dir}/${f.filename}` : f.filename;
      return abs === wantedPath || f.filename === wantedName || f.filename.endsWith('/' + wantedName);
    });
    if (!target) return;
    if (target.id !== activeFileId) {
      pendingJumpRef.current = { line: frame.line, column: frame.column };
      openFile(target.id);
    } else {
      onJumpRef.current?.(frame.line, frame.column);
    }
  }, [session, activeFileId, openFile]);

  // Breakpoints (1-indexed lines) for the active file, looked up by its
  // absolute path. Active for both display in the gutter and for stop-line
  // matching below.
  const activeFileAbsPath = useMemo(() => {
    if (!session || !activeFileId) return null;
    const file = session.files.find((f) => f.id === activeFileId);
    if (!file) return null;
    return session.absolute_working_dir
      ? `${session.absolute_working_dir}/${file.filename}`
      : file.filename;
  }, [session, activeFileId]);

  // Combine the user's breakpoint set with the adapter's verification status.
  // Before the debugger runs, every breakpoint is unverified (hollow ring).
  // After setBreakpoints round-trips during a debug session, the ones earlybird
  // could resolve switch to solid.
  const activeFileBreakpoints = useMemo(() => {
    if (!activeFileAbsPath) return undefined;
    const lines = breakpoints.get(activeFileAbsPath);
    if (!lines || lines.length === 0) return undefined;
    const verifiedForFile = dap.verifiedBreakpoints.get(activeFileAbsPath);
    const out = new Map<number, boolean>();
    for (const line of lines) {
      out.set(line, verifiedForFile?.get(line) ?? false);
    }
    return out;
  }, [activeFileAbsPath, breakpoints, dap.verifiedBreakpoints]);

  // Stopped-line decoration is only shown when the debugger is paused IN the
  // currently open file. Otherwise it's null so the marker clears.
  const activeFileStoppedLine = useMemo(() => {
    if (!debugStoppedLocation || !activeFileAbsPath) return null;
    return debugStoppedLocation.file === activeFileAbsPath ? debugStoppedLocation.line : null;
  }, [debugStoppedLocation, activeFileAbsPath]);

  // API-reference sources for this session's language. Notebooks are Python
  // (Jupyter). Memoized so the ReferencePanel's restore effect stays stable.
  const referenceSources = useMemo(
    () => getReferenceSources(isNotebook ? 'python' : (session?.language ?? '')),
    [isNotebook, session?.language],
  );

  const handleExecute = async () => {
    if (!id || executing) return;
    setExecuting(true);
    try {
      if (isDuneProject) {
        const flavor = duneFlavorFromId(duneProfileId);
        const result = await executionService.execute(id, {
          file_id: activeFileId ?? undefined,
          flavor,
          target: duneTarget || undefined,
        });
        if (result.kind === 'ran') {
          applyDuneBuildResponse({
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
          applyDuneBuildResponse({
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
      } else if (isCmakeProject) {
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
      openFile(target.id);
    } else {
      onJumpRef.current?.(d.line, d.column);
    }
  }, [session?.files, activeFileId, openFile]);

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
      } else if (isFreeformOcaml && fileUriRef.current) {
        ocamlLspRef.current.sendDidChange(fileUriRef.current, code);
      }
    }
  }, [id, activeFileId, isLean, isFreeformCpp, isFreeformOcaml, isNotebook]);

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

  const handleBookLinkSearch = async () => {
    setLinkBookSearching(true);
    try {
      const results = await scribeService.searchBooks(linkBookSearch);
      setLinkBookResults(results);
    } catch {
      setLinkBookResults([]);
    } finally {
      setLinkBookSearching(false);
    }
  };

  const resetBookLinkForm = () => {
    setLinkAddMode(null);
    setLinkBookSearch('');
    setLinkBookResults([]);
    setLinkBookPage('');
  };

  const handleAddBookLink = (book: ScribeBook) => {
    if (!session) return;
    const page = parseInt(linkBookPage, 10);
    const newLink: SessionLink = {
      app: 'scribe',
      ref_type: 'book',
      ref_id: book.id,
      label: book.filename,
      ...(Number.isFinite(page) && page > 0 ? { page } : {}),
    };
    updateLinks([...session.links, newLink]);
    resetBookLinkForm();
  };

  const handleAddTextLink = () => {
    if (!session || !linkAddMode || linkAddMode === 'scribe' || linkAddMode === 'scribe-book' || !linkInputValue.trim()) return;
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

  // OCaml LSP: completion + hover sources for the editor
  const ocamlExternalCompletion = useCallback(async (code: string, cursorPos: number) => {
    if (!isFreeformOcaml || !fileUriRef.current) return null;
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < cursorPos; i++) {
      if (code.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
    }
    const character = cursorPos - lineStart;
    const items = await ocamlLspRef.current.requestCompletion(fileUriRef.current, line, character);
    if (!items || items.length === 0) return null;
    // Replacement range: word characters + apostrophes (OCaml identifiers can
    // contain ') before cursor.
    let from = cursorPos;
    while (from > 0) {
      const c = code.charCodeAt(from - 1);
      const isWord = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 39;
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
  }, [isFreeformOcaml]);

  const ocamlExternalHover = useCallback(async (line: number, character: number) => {
    if (!isFreeformOcaml || !fileUriRef.current) return null;
    return await ocamlLspRef.current.requestHover(fileUriRef.current, line, character);
  }, [isFreeformOcaml]);

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (error) return <div className={styles.error}>Error: {error}</div>;
  if (!session) return <div className={styles.error}>Session not found</div>;

  const latestRun = runs[0];

  const activeFile = activeFileId ? session.files.find(f => f.id === activeFileId) : null;
  const activeFileExt = activeFile?.filename.split('.').pop()?.toLowerCase() ?? '';
  // clangd integration (diagnostics, completion, hover, outline) only applies
  // to actual C/C++ source files within a freeform C++ session.
  const activeFileIsCpp = isFreeformCpp && CPP_SOURCE_EXTS.has(activeFileExt);
  // Same gating for ocamllsp + *.ml/*.mli.
  const activeFileIsOcaml = isFreeformOcaml && OCAML_SOURCE_EXTS.has(activeFileExt);

  // Lake status badge variant
  const lakeStatusVariant = lakeStatus === 'ready' ? 'success'
    : lakeStatus === 'error' ? 'danger'
    : lakeStatus === 'building' ? 'warning'
    : 'default';

  return (
    <div className={styles.page}>
      {!fullscreen && (
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <h2 className={styles.sessionTitle}>{session.title}</h2>
          <Badge label={session.session_type} variant={session.session_type} />
          <Badge label={session.language} />
          {isLean && (
            <Badge label={lakeStatus} variant={lakeStatusVariant} />
          )}
          {isCmakeProject && (
            <Badge label={`cmake: ${cmakeFlavorId}`} variant="default" />
          )}
          {isDuneProject && (
            <Badge label={`dune: ${duneProfileId}`} variant="default" />
          )}
        </div>
        <div className={styles.toolbarRight}>
          <button
            className={`${styles.suspendButton} ${suspended ? styles.suspendButtonActive : ''}`}
            onClick={() => setSuspended(s => !s)}
            title={
              suspended
                ? 'Resume language server, kernel, and terminal connections'
                : 'Stop language server, kernel, and terminal connections — keeps the editor and notes usable'
            }
          >
            {suspended ? 'Resume' : 'Suspend'}
          </button>
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
              {isDuneProject && (
                <>
                  <select
                    className={styles.flavorSelect}
                    value={duneProfileId}
                    onChange={e => setDuneProfileId(e.target.value as DuneProfile)}
                    title="Dune profile"
                  >
                    {DUNE_PROFILE_PRESETS.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                  <select
                    className={styles.flavorSelect}
                    value={duneTarget}
                    onChange={e => setDuneTarget(e.target.value)}
                    title="Run target"
                  >
                    <option value="">(auto)</option>
                    {duneTargets.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <button
                    className={styles.buildButton}
                    onClick={handleDuneBuild}
                    disabled={duneBuilding}
                  >
                    {duneBuilding ? 'Building...' : 'Build'}
                  </button>
                  <button
                    className={styles.buildButton}
                    onClick={() => {
                      setActiveTab('debug');
                      // Don't auto-launch — the panel's Start button handles
                      // that so the user can pick a target first.
                    }}
                    disabled={dap.state === 'connecting' || dap.state === 'initializing'}
                    title={debugTargets.length === 0 ? 'No .bc targets — add (modes byte exe) to your executable' : 'Open debug panel'}
                  >
                    {dap.state === 'stopped' ? 'Debug (stopped)' :
                      dap.state === 'running' ? 'Debug (running)' : 'Debug'}
                  </button>
                </>
              )}
              <button className={styles.runButton} onClick={handleExecute} disabled={executing}>
                {executing ? ((isCmakeProject || isDuneProject) ? 'Building/Running...' : 'Running...') : 'Run'}
              </button>
              {((cmakeLastBuild && !cmakeLastBuild.success) || (duneLastBuild && !duneLastBuild.success) || (latestRun && (latestRun.exit_code !== 0 || latestRun.stderr))) && (
                <button className={styles.askClaudeButton} onClick={handleAskClaude}>Ask Claude</button>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {suspended && (
        <div className={styles.suspendBanner} role="status">
          Session suspended — language server, kernel, and terminal connections are stopped.
          The editor and notes still work. Click Resume to reconnect.
        </div>
      )}

      <div className={styles.workbench} ref={containerRef}>
        <div
          className={styles.editorPane}
          style={panelCollapsed ? { flex: 1 } : { flexBasis: `${ratio * 100}%` }}
        >
          {isNotebook ? (
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
                    onSelectFile={openFile}
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
                <FileTabs
                  files={session.files}
                  openFileIds={openFileIds}
                  activeFileId={activeFileId}
                  onSelect={setActiveFileId}
                  onClose={closeFile}
                />
                <div className={styles.editorBody}>
                  {!activeFileId ? (
                    <WelcomeScreen files={session.files} onOpenFile={openFile} />
                  ) : activeFileExt === 'ipynb' ? (
                    <NotebookEditor sessionId={id!} fileId={activeFileId} fontSize={fontSize} suspended={suspended} />
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
            </div>
          ) : isLean ? (
            <>
              <FileTabs
                files={session.files}
                openFileIds={openFileIds}
                activeFileId={activeFileId}
                onSelect={setActiveFileId}
                onClose={closeFile}
              />
              <SymbolPalette onInsert={(s) => insertRef.current?.(s)} />
              <div className={styles.editorContainer}>
                <div className={styles.editorBody}>
                  {!activeFileId ? (
                    <WelcomeScreen files={session.files} onOpenFile={openFile} />
                  ) : (
                    <CodeEditor
                      value={fileContent}
                      language={session.language}
                      onChange={handleSaveFile}
                      onCursorChange={handleCursorChange}
                      diagnostics={lsp.diagnostics}
                      fontSize={fontSize}
                      onInsertRef={insertRef}
                    />
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className={styles.editorWithTree}>
              <div className={styles.fileTreePanel}>
                <FileTree
                  sessionId={id!}
                  files={session.files}
                  activeFileId={activeFileId}
                  onSelectFile={openFile}
                  onFilesChanged={refresh}
                  sessionLanguage={session.language}
                />
              </div>
              <div className={styles.editorContainer}>
                <FileTabs
                  files={session.files}
                  openFileIds={openFileIds}
                  activeFileId={activeFileId}
                  onSelect={setActiveFileId}
                  onClose={closeFile}
                />
                <div className={styles.editorBody}>
                  {!activeFileId ? (
                    <WelcomeScreen files={session.files} onOpenFile={openFile} />
                  ) : (
                    <CodeEditor
                      value={fileContent}
                      language={session.language}
                      onChange={handleSaveFile}
                      onCursorChange={activeFileIsCpp || activeFileIsOcaml ? handleCursorChange : undefined}
                      diagnostics={
                        activeFileIsCpp ? cppLsp.diagnostics
                        : activeFileIsOcaml ? ocamlLsp.diagnostics
                        : undefined
                      }
                      externalCompletion={
                        activeFileIsCpp ? cppExternalCompletion
                        : activeFileIsOcaml ? ocamlExternalCompletion
                        : undefined
                      }
                      externalHover={
                        activeFileIsCpp ? cppExternalHover
                        : activeFileIsOcaml ? ocamlExternalHover
                        : undefined
                      }
                      fontSize={fontSize}
                      onInsertRef={insertRef}
                      onJumpRef={onJumpRef}
                      onGetSelectionRef={activeFileIsCpp ? getSelectionRef : undefined}
                      setHighlightedLineRef={activeFileIsCpp ? setHighlightedLineRef : undefined}
                      showBreakpointGutter={activeFileIsOcaml && isDuneProject}
                      breakpoints={activeFileBreakpoints}
                      onBreakpointToggle={handleBreakpointToggle}
                      debugStoppedLine={activeFileStoppedLine}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {panelCollapsed ? (
          <button
            className={styles.panelExpandBtn}
            onClick={() => setPanelCollapsed(false)}
            title="Show panel (p)"
            aria-label="Show panel"
          >
            <ChevronLeftIcon size={16} />
          </button>
        ) : (
        <>
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
                {referenceSources.length > 0 && (
                  <button
                    className={`${styles.tab} ${activeTab === 'reference' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('reference')}
                  >
                    Reference
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
                {(isCmakeProject || isDuneProject) && (
                  <button
                    className={`${styles.tab} ${activeTab === 'build' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('build')}
                  >
                    Build
                    {((cmakeLastBuild && !cmakeLastBuild.success) || (duneLastBuild && !duneLastBuild.success)) && (
                      <span className={styles.tabBadge}>!</span>
                    )}
                  </button>
                )}
                {(isCmakeProject || isDuneProject) && (
                  <button
                    className={`${styles.tab} ${activeTab === 'artifacts' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('artifacts')}
                  >
                    Artifacts
                  </button>
                )}
                {(isFreeformCpp || isFreeformOcaml) && (
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
                {isFreeformOcaml && isDuneProject && (
                  <button
                    className={`${styles.tab} ${activeTab === 'debug' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('debug')}
                  >
                    Debug
                    {dap.state === 'stopped' && <span className={styles.tabBadge}>!</span>}
                  </button>
                )}
                {isNotebook && (
                  <button
                    className={`${styles.tab} ${activeTab === 'variables' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('variables')}
                  >
                    Variables
                  </button>
                )}
                {referenceSources.length > 0 && (
                  <button
                    className={`${styles.tab} ${activeTab === 'reference' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('reference')}
                  >
                    Reference
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
            <button
              className={styles.panelCollapseBtn}
              onClick={() => setPanelCollapsed(true)}
              title="Hide panel (p)"
              aria-label="Hide panel"
            >
              <ChevronRightIcon size={14} />
            </button>
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
                          {link.page ? <span className={styles.linkPage}> · p.{link.page}</span> : null}
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
                      <button className={styles.addLinkBtn} onClick={() => setLinkAddMode('scribe')}>+ Scribe Node</button>
                      <button className={styles.addLinkBtn} onClick={() => setLinkAddMode('scribe-book')}>+ Scribe Book</button>
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
                  ) : linkAddMode === 'scribe-book' ? (
                    <div className={styles.linkForm}>
                      <div className={styles.linkFormHeader}>
                        <span>Link to Scribe book</span>
                        <button className={styles.linkFormCancel} onClick={resetBookLinkForm}>&times;</button>
                      </div>
                      <div className={styles.linkFormRow}>
                        <input
                          className={styles.linkFormInput}
                          type="text"
                          value={linkBookSearch}
                          onChange={e => setLinkBookSearch(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleBookLinkSearch()}
                          placeholder="Search PDF library by filename or subject..."
                          autoFocus
                        />
                        <button className={styles.linkFormBtn} onClick={handleBookLinkSearch} disabled={linkBookSearching}>
                          {linkBookSearching ? '...' : 'Search'}
                        </button>
                      </div>
                      <div className={styles.linkFormRow}>
                        <input
                          className={styles.linkFormInput}
                          type="number"
                          min="1"
                          value={linkBookPage}
                          onChange={e => setLinkBookPage(e.target.value)}
                          placeholder="Page (optional)"
                        />
                      </div>
                      {linkBookResults.length > 0 && (
                        <div className={styles.linkScribeResults}>
                          {linkBookResults.map(book => (
                            <button
                              key={book.id}
                              className={styles.linkScribeResultItem}
                              onClick={() => handleAddBookLink(book)}
                            >
                              <span className={styles.linkScribeTitle}>{book.filename}</span>
                              {book.subject && (
                                <span className={styles.linkScribeFlowchart}>{book.subject}</span>
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

            {/* OCaml: Outline (ocamllsp documentSymbol) */}
            {activeTab === 'outline' && isFreeformOcaml && (
              <OutlinePanel
                symbols={ocamlSymbols}
                loading={ocamlSymbolsLoading}
                initialized={ocamlLsp.initialized}
                onSelect={handleOutlineSelect}
              />
            )}

            {/* Notebook: Variable Inspector */}
            {isNotebook && (
              <div style={{ display: activeTab === 'variables' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                <VariableInspector
                  sessionId={id!}
                  active={activeTab === 'variables'}
                  suspended={suspended}
                />
              </div>
            )}

            {/* C++: Compiler Explorer (godbolt.org) */}
            {activeTab === 'asm' && isFreeformCpp && (
              <CompilerExplorerPanel
                fileName={session.files.find(f => f.id === activeFileId)?.filename || ''}
                fileContent={fileContent}
                getSelection={getSelectionStable}
                cursorLine={editorCursorLine}
                setHighlightedSourceLine={setHighlightedSourceLineStable}
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
                  fetchHistory={cppBuildService.history}
                  emptyPlaceholder="Click Build to run CMake configure + build for the active flavor."
                  onDiagnosticClick={handleDiagnosticClick}
                />
              </div>
            )}

            {/* CMake: Artifact browser */}
            {activeTab === 'artifacts' && isCmakeProject && (
              <ArtifactBrowser sessionId={id!} refreshKey={cmakeHistoryRefresh} service={cppBuildService} />
            )}

            {/* Dune: Build panel */}
            {activeTab === 'build' && isDuneProject && (
              <div className={styles.buildTabPane}>
                {duneBuildError && (
                  <div className={styles.buildError}>{duneBuildError}</div>
                )}
                <BuildPanel
                  sessionId={id!}
                  latest={duneLastBuild}
                  refreshKey={duneHistoryRefresh}
                  fetchHistory={duneBuildService.history}
                  emptyPlaceholder="Click Build to run dune build for the active profile."
                  onDiagnosticClick={handleDiagnosticClick}
                />
              </div>
            )}

            {/* Dune: Artifact browser */}
            {activeTab === 'artifacts' && isDuneProject && (
              <ArtifactBrowser
                sessionId={id!}
                refreshKey={duneHistoryRefresh}
                service={duneBuildService}
                rootLabel="_build/"
              />
            )}

            {/* OCaml: Debugger panel (earlybird DAP) */}
            {activeTab === 'debug' && isFreeformOcaml && isDuneProject && (
              <DebugPanel
                state={dap.state}
                error={dap.error}
                output={dap.output}
                frames={dap.frames}
                activeFrameId={dap.activeFrameId}
                scopes={dap.scopes}
                variables={dap.variables}
                targets={debugTargets}
                selectedTarget={selectedDebugTarget}
                onTargetChange={setSelectedDebugTarget}
                onStart={handleDebugStart}
                onContinue={dap.continue}
                onStepOver={dap.next}
                onStepIn={dap.stepIn}
                onStepOut={dap.stepOut}
                onPause={dap.pause}
                onStop={dap.disconnect}
                onFrameClick={handleDebugFrameClick}
              />
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
                        {latestRun.peak_rss_bytes != null && ` | ${formatBytes(latestRun.peak_rss_bytes)} peak`}
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
                          {run.exit_code !== null ? `exit ${run.exit_code}` : 'timeout'} | {run.duration_ms}ms{run.peak_rss_bytes != null ? ` | ${formatBytes(run.peak_rss_bytes)}` : ''} | {new Date(run.created_at).toLocaleTimeString()}
                        </span>
                        {run.stdout && <pre className={styles.historyOutput}>{run.stdout.slice(0, 200)}</pre>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Reference: embedded API docs (numpy/pandas/cppreference/...) */}
            {referenceSources.length > 0 && (
              <div style={{ display: activeTab === 'reference' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                <ReferencePanel sessionId={id!} sources={referenceSources} />
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
                <TerminalPane sessionId={id!} visible={true} suspended={suspended} />
              </div>
            </>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}

export default SessionPage;
