import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  godboltService,
  type GodboltCompiler,
  type GodboltCompileResponse,
} from '../../services/godboltService';
import type { EditorSelection } from '../CodeEditor/CodeEditor';
import styles from './CompilerExplorerPanel.module.css';

interface CompilerExplorerPanelProps {
  fileName: string;
  fileContent: string;
  // Returns the live editor selection. Provided so we read the *current*
  // selection at compile time, not whatever was selected at mount.
  getSelection: () => EditorSelection | null;
}

const COMPILER_KEY = 'pyramid_godbolt_compiler';
const FLAGS_KEY = 'pyramid_godbolt_flags';
const INTEL_KEY = 'pyramid_godbolt_intel';
const DEFAULT_FLAGS = '-O2 -std=c++20';

interface ScopeChoice {
  source: string;
  // 1-indexed source line number that the source[] starts on. Used to map
  // compiler-emitted line numbers back to the original file when we sent only
  // a slice.
  lineOffset: number;
  label: string;
}

function pickScope(file: { name: string; content: string }, sel: EditorSelection | null): ScopeChoice {
  if (sel && !sel.empty && sel.text.trim().length > 0) {
    return {
      source: sel.text,
      lineOffset: sel.startLine - 1,
      label: `selection (lines ${sel.startLine}–${sel.endLine})`,
    };
  }
  return {
    source: file.content,
    lineOffset: 0,
    label: file.name || 'whole file',
  };
}

function joinTextLines(arr: { text: string }[]): string {
  return arr.map((l) => l.text).join('\n');
}

export default function CompilerExplorerPanel({ fileName, fileContent, getSelection }: CompilerExplorerPanelProps) {
  const [compilers, setCompilers] = useState<GodboltCompiler[]>([]);
  const [compilersLoading, setCompilersLoading] = useState(false);
  const [compilersError, setCompilersError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const [compilerId, setCompilerId] = useState<string>(() => localStorage.getItem(COMPILER_KEY) ?? '');
  const [flags, setFlags] = useState<string>(() => localStorage.getItem(FLAGS_KEY) ?? DEFAULT_FLAGS);
  const [intel, setIntel] = useState<boolean>(() => localStorage.getItem(INTEL_KEY) !== '0');

  const [compiling, setCompiling] = useState(false);
  const [result, setResult] = useState<GodboltCompileResponse | null>(null);
  const [resultScope, setResultScope] = useState<ScopeChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load compilers on mount.
  useEffect(() => {
    let cancelled = false;
    setCompilersLoading(true);
    godboltService
      .listCompilers('c++')
      .then((res) => {
        if (cancelled) return;
        setCompilers(res.compilers);
        setCompilersError(null);
        // If the saved compiler id is not in the list, pick a sensible default.
        if (!res.compilers.find((c) => c.id === compilerId)) {
          const fallback = res.compilers.find((c) => /^g\d/i.test(c.id) || /^clang/i.test(c.id))
            ?? res.compilers[0];
          if (fallback) setCompilerId(fallback.id);
        }
      })
      .catch((err) => {
        if (!cancelled) setCompilersError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setCompilersLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (compilerId) localStorage.setItem(COMPILER_KEY, compilerId); }, [compilerId]);
  useEffect(() => { localStorage.setItem(FLAGS_KEY, flags); }, [flags]);
  useEffect(() => { localStorage.setItem(INTEL_KEY, intel ? '1' : '0'); }, [intel]);

  const filteredCompilers = useMemo(() => {
    if (!filter.trim()) return compilers;
    const q = filter.trim().toLowerCase();
    return compilers.filter((c) =>
      c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }, [compilers, filter]);

  // Keep the latest selection accessor in a ref so the compile callback is
  // stable but always reads the live selection.
  const getSelectionRef = useRef(getSelection);
  getSelectionRef.current = getSelection;

  const handleCompile = useCallback(async () => {
    if (!compilerId || compiling) return;
    const sel = getSelectionRef.current?.() ?? null;
    const scope = pickScope({ name: fileName, content: fileContent }, sel);
    if (!scope.source.trim()) {
      setError('Nothing to compile — file is empty.');
      return;
    }
    setCompiling(true);
    setError(null);
    try {
      const res = await godboltService.compile({
        compilerId,
        source: scope.source,
        userArguments: flags,
        filters: { intel, demangle: true, labels: true, directives: true, libraryCode: false, commentOnly: true },
      });
      setResult(res);
      setResultScope(scope);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCompiling(false);
    }
  }, [compilerId, compiling, fileName, fileContent, flags, intel]);

  const stderrText = result ? joinTextLines(result.stderr) : '';
  const stdoutText = result ? joinTextLines(result.stdout) : '';
  const exitOk = result ? result.code === 0 : false;

  const sel = getSelection();
  const scopeLabel = sel && !sel.empty
    ? `selection (lines ${sel.startLine}–${sel.endLine})`
    : `whole file (${fileName || 'untitled'})`;

  return (
    <div className={styles.root}>
      <div className={styles.controls}>
        <div className={styles.controlRow}>
          <label className={styles.label}>Compiler</label>
          <input
            type="text"
            className={styles.filterInput}
            placeholder="Filter (e.g. gcc 14, clang trunk)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            className={styles.compilerSelect}
            value={compilerId}
            onChange={(e) => setCompilerId(e.target.value)}
            disabled={compilersLoading || compilers.length === 0}
          >
            {compilersLoading && <option value="">Loading compilers...</option>}
            {!compilersLoading && filteredCompilers.length === 0 && <option value="">No matches</option>}
            {filteredCompilers.slice(0, 200).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className={styles.controlRow}>
          <label className={styles.label}>Flags</label>
          <input
            type="text"
            className={styles.flagsInput}
            value={flags}
            placeholder={DEFAULT_FLAGS}
            onChange={(e) => setFlags(e.target.value)}
          />
          <label className={styles.checkboxLabel} title="Intel syntax (vs AT&T)">
            <input type="checkbox" checked={intel} onChange={(e) => setIntel(e.target.checked)} />
            Intel
          </label>
        </div>

        <div className={styles.controlRow}>
          <span className={styles.scopeHint}>Scope: {scopeLabel}</span>
          <button
            className={styles.compileBtn}
            onClick={handleCompile}
            disabled={compiling || !compilerId}
          >
            {compiling ? 'Compiling…' : 'Compile'}
          </button>
        </div>

        {compilersError && (
          <div className={styles.error}>Failed to load compilers: {compilersError}</div>
        )}
        {error && (
          <div className={styles.error}>{error}</div>
        )}
      </div>

      {result && (
        <div className={styles.result}>
          <div className={styles.resultHeader}>
            <span className={`${styles.statusPill} ${exitOk ? styles.statusOk : styles.statusFail}`}>
              {exitOk ? 'ok' : `exit ${result.code}`}
            </span>
            {result.execTime && <span className={styles.duration}>{result.execTime} ms</span>}
            {resultScope && <span className={styles.scopeTag}>{resultScope.label}</span>}
            {result.truncated && <span className={styles.warn}>output truncated</span>}
          </div>

          {stderrText && (
            <div className={styles.stderr}>
              <div className={styles.sectionLabel}>stderr</div>
              <pre className={styles.stderrPre}>{stderrText}</pre>
            </div>
          )}

          {stdoutText && (
            <div className={styles.stdoutSection}>
              <div className={styles.sectionLabel}>stdout</div>
              <pre className={styles.stdoutPre}>{stdoutText}</pre>
            </div>
          )}

          <div className={styles.asmSection}>
            <div className={styles.sectionLabel}>asm</div>
            {result.asm.length === 0 ? (
              <div className={styles.placeholderSmall}>No assembly produced.</div>
            ) : (
              <div className={styles.asmList}>
                {result.asm.map((line, i) => {
                  const srcLine = line.source?.line;
                  const isLabel = !!line.text && !line.text.startsWith(' ') && !line.text.startsWith('\t')
                    && line.text.trim().endsWith(':');
                  const isDirective = line.text.trimStart().startsWith('.');
                  const cls = isLabel ? styles.asmLabel : isDirective ? styles.asmDirective : styles.asmInstr;
                  return (
                    <div key={i} className={`${styles.asmLine} ${cls}`}>
                      <span className={styles.asmLineNo}>
                        {srcLine != null
                          ? (resultScope ? srcLine + resultScope.lineOffset : srcLine)
                          : ''}
                      </span>
                      <pre className={styles.asmText}>{line.text || ' '}</pre>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {!result && !compiling && !error && (
        <div className={styles.placeholder}>
          Select code in the editor and press <strong>Compile</strong> to see assembly from godbolt.org.
          With nothing selected, the whole file is sent.
        </div>
      )}
    </div>
  );
}
