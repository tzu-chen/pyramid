import { useEffect, useState, useCallback } from 'react';
import {
  cppBuildService,
  type BuildResponse,
  type BuildHistoryEntry,
  type CompilerDiagnostic,
} from '../../services/cppBuildService';
import styles from './BuildPanel.module.css';

interface BuildPanelProps {
  sessionId: string;
  // Most-recent build result from this session in memory (Build / Run press).
  latest: BuildResponse | null;
  // Refresh signal — increment to force a history reload.
  refreshKey: number;
  // Click a diagnostic → jump in the editor.
  onDiagnosticClick?: (d: CompilerDiagnostic) => void;
}

function severityClass(sev: CompilerDiagnostic['severity']): string {
  if (sev === 'error') return styles.diagError;
  if (sev === 'warning') return styles.diagWarning;
  return styles.diagNote;
}

export default function BuildPanel({ sessionId, latest, refreshKey, onDiagnosticClick }: BuildPanelProps) {
  const [history, setHistory] = useState<BuildHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [logExpanded, setLogExpanded] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const list = await cppBuildService.history(sessionId, 20);
      setHistory(list);
      setHistoryError(null);
    } catch (e) {
      setHistoryError((e as Error).message);
    }
  }, [sessionId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, refreshKey]);

  return (
    <div className={styles.root}>
      {latest ? (
        <div className={styles.latest}>
          <div className={styles.headerRow}>
            <span className={`${styles.statusPill} ${latest.success ? styles.statusOk : styles.statusFail}`}>
              {latest.success ? 'success' : 'failed'}
            </span>
            <span className={styles.flavorTag}>{latest.flavor}</span>
            <span className={styles.duration}>{latest.duration_ms} ms</span>
            <span className={styles.diagCount}>
              {latest.diagnostics.length === 0 ? 'no diagnostics' :
                `${latest.diagnostics.filter(d => d.severity === 'error').length}E `
                + `${latest.diagnostics.filter(d => d.severity === 'warning').length}W `
                + `${latest.diagnostics.filter(d => d.severity === 'note').length}N`}
            </span>
          </div>

          {latest.diagnostics.length > 0 && (
            <ul className={styles.diagList}>
              {latest.diagnostics.map((d, i) => (
                <li key={i} className={styles.diagItem}>
                  <button
                    className={`${styles.diagButton} ${severityClass(d.severity)}`}
                    onClick={() => onDiagnosticClick?.(d)}
                    title={`${d.file}:${d.line}:${d.column}`}
                  >
                    <span className={styles.diagLoc}>
                      {d.file}:{d.line}:{d.column}
                    </span>
                    <span className={styles.diagSev}>{d.severity}</span>
                    <pre className={styles.diagMessage}>{d.message}</pre>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {latest.binary_paths.length > 0 && (
            <div className={styles.binariesRow}>
              <div className={styles.sectionLabel}>Executables</div>
              <ul className={styles.binList}>
                {latest.binary_paths.map((p) => (
                  <li key={p} className={styles.binItem} title={p}>{p.split('/').pop()}</li>
                ))}
              </ul>
            </div>
          )}

          {latest.log && (
            <div className={styles.logSection}>
              <button
                className={styles.logToggle}
                onClick={() => setLogExpanded(v => !v)}
              >
                {logExpanded ? '▾ Hide build log' : '▸ Show build log'}
              </button>
              {logExpanded && (
                <pre className={styles.logContent}>{latest.log}</pre>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.placeholder}>Click Build to run CMake configure + build for the active flavor.</div>
      )}

      <div className={styles.historySection}>
        <div className={styles.sectionLabel}>Build history</div>
        {historyError && <div className={styles.error}>{historyError}</div>}
        {history.length === 0 ? (
          <div className={styles.placeholderSmall}>No builds yet for this session.</div>
        ) : (
          <ul className={styles.historyList}>
            {history.map((b) => (
              <li key={b.id} className={styles.historyItem}>
                <span className={`${styles.historyStatus} ${b.success ? styles.statusOk : styles.statusFail}`}>
                  {b.success ? 'ok' : 'fail'}
                </span>
                <span className={styles.historyFlavor}>{b.flavor}</span>
                <span className={styles.historyMeta}>{b.duration_ms} ms</span>
                <span className={styles.historyMeta}>{b.diagnostic_count} diag</span>
                <span className={styles.historyTime}>{new Date(b.created_at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
