import { useCallback, useMemo, useState } from 'react';
import type {
  DapState,
  DapStackFrame,
  DapScope,
  DapVariable,
  DapOutputEntry,
} from '../../hooks/useDapSession';
import styles from './DebugPanel.module.css';

interface DebugPanelProps {
  state: DapState;
  error: string | null;
  output: DapOutputEntry[];
  frames: DapStackFrame[];
  activeFrameId: number | null;
  scopes: DapScope[];
  variables: Map<number, DapVariable[]>;
  // Bytecode target picker. Empty = no .bc artifacts in _build/.
  targets: string[];
  selectedTarget: string;
  onTargetChange: (t: string) => void;
  onStart: (stopOnEntry: boolean) => void;
  onContinue: () => void;
  onStepOver: () => void;
  onStepIn: () => void;
  onStepOut: () => void;
  onPause: () => void;
  onStop: () => void;
  // Click a stack frame → jump in the editor.
  onFrameClick?: (frame: DapStackFrame) => void;
}

function isActive(state: DapState): boolean {
  return state !== 'idle' && state !== 'terminated';
}

function isStopped(state: DapState): boolean {
  return state === 'stopped';
}

function isRunning(state: DapState): boolean {
  return state === 'running';
}

const STATE_LABEL: Record<DapState, string> = {
  idle: 'not started',
  connecting: 'connecting',
  initializing: 'initializing',
  launching: 'launching',
  running: 'running',
  stopped: 'stopped',
  terminated: 'terminated',
};

const STATE_PILL: Record<DapState, string> = {
  idle: styles.pillIdle,
  connecting: styles.pillBusy,
  initializing: styles.pillBusy,
  launching: styles.pillBusy,
  running: styles.pillRunning,
  stopped: styles.pillStopped,
  terminated: styles.pillIdle,
};

function categoryClass(cat: string): string {
  switch (cat) {
    case 'stdout': return styles.outStdout;
    case 'stderr': return styles.outStderr;
    case 'important': return styles.outImportant;
    case 'console': return styles.outConsole;
    default: return styles.outConsole;
  }
}

export default function DebugPanel({
  state, error, output, frames, activeFrameId, scopes, variables,
  targets, selectedTarget, onTargetChange,
  onStart, onContinue, onStepOver, onStepIn, onStepOut, onPause, onStop,
  onFrameClick,
}: DebugPanelProps) {
  const canStart = !isActive(state);
  const startLabel = canStart ? (state === 'terminated' ? 'Restart' : 'Start') : 'Running…';
  const noTargets = targets.length === 0;
  const [stopOnEntry, setStopOnEntry] = useState(false);

  const handleStartClick = useCallback(() => {
    if (canStart) onStart(stopOnEntry);
  }, [canStart, onStart, stopOnEntry]);

  // Variables for the active frame's scopes.
  const visibleVariables = useMemo(() => {
    return scopes.map((s) => ({
      scope: s,
      vars: variables.get(s.variablesReference) ?? [],
    }));
  }, [scopes, variables]);

  return (
    <div className={styles.root}>
      <div className={styles.headerRow}>
        <span className={`${styles.pill} ${STATE_PILL[state]}`}>{STATE_LABEL[state]}</span>
        <select
          className={styles.targetSelect}
          value={selectedTarget}
          onChange={(e) => onTargetChange(e.target.value)}
          title="Bytecode target to debug"
          disabled={isActive(state)}
        >
          {noTargets && <option value="">(no .bc targets)</option>}
          {!noTargets && !selectedTarget && <option value="">(pick a target)</option>}
          {targets.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <label
          className={styles.stopOnEntryLabel}
          title="Pause at the first executable line — handy for verifying the debug pipeline works regardless of breakpoint resolution."
        >
          <input
            type="checkbox"
            checked={stopOnEntry}
            onChange={(e) => setStopOnEntry(e.target.checked)}
            disabled={isActive(state)}
          />
          stop on entry
        </label>
        <div className={styles.controls}>
          <button
            className={styles.startBtn}
            onClick={handleStartClick}
            disabled={!canStart || noTargets || !selectedTarget}
            title={noTargets ? 'Build a (modes byte exe) executable first' : startLabel}
          >
            {startLabel}
          </button>
          <button
            className={styles.ctrlBtn}
            onClick={onContinue}
            disabled={!isStopped(state)}
            title="Continue (F5)"
          >▶ continue</button>
          <button
            className={styles.ctrlBtn}
            onClick={onStepOver}
            disabled={!isStopped(state)}
            title="Step over (F10)"
          >↷ step</button>
          <button
            className={styles.ctrlBtn}
            onClick={onStepIn}
            disabled={!isStopped(state)}
            title="Step in (F11)"
          >↓ in</button>
          <button
            className={styles.ctrlBtn}
            onClick={onStepOut}
            disabled={!isStopped(state)}
            title="Step out (Shift+F11)"
          >↑ out</button>
          <button
            className={styles.ctrlBtn}
            onClick={onPause}
            disabled={!isRunning(state)}
            title="Pause"
          >⏸ pause</button>
          <button
            className={`${styles.ctrlBtn} ${styles.stopBtn}`}
            onClick={onStop}
            disabled={!isActive(state)}
            title="Stop"
          >■ stop</button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {noTargets && state === 'idle' && (
        <div className={styles.hint}>
          No bytecode artifacts found in <code>_build/&lt;profile&gt;/</code>. earlybird debugs OCaml bytecode,
          so the executable stanza you want to debug needs <code>(modes byte exe)</code> (or just <code>byte</code>).
          Add that, rebuild, then start debugging.
        </div>
      )}

      <div className={styles.columns}>
        <div className={styles.col}>
          <div className={styles.sectionLabel}>Call Stack</div>
          {frames.length === 0 ? (
            <div className={styles.placeholderSmall}>
              {isStopped(state) ? 'No frames' : 'Stopped frames appear here.'}
            </div>
          ) : (
            <ul className={styles.frameList}>
              {frames.map((f) => (
                <li
                  key={f.id}
                  className={`${styles.frameItem} ${f.id === activeFrameId ? styles.frameActive : ''}`}
                  onClick={() => onFrameClick?.(f)}
                  title={f.source?.path ? `${f.source.path}:${f.line}:${f.column}` : f.name}
                >
                  <span className={styles.frameName}>{f.name}</span>
                  {f.source && (
                    <span className={styles.frameLoc}>
                      {f.source.name ?? (f.source.path ?? '').split('/').pop()}:{f.line}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.col}>
          <div className={styles.sectionLabel}>Variables</div>
          {visibleVariables.length === 0 ? (
            <div className={styles.placeholderSmall}>Variables appear when stopped.</div>
          ) : (
            visibleVariables.map(({ scope, vars }) => (
              <div key={scope.variablesReference} className={styles.scopeBlock}>
                <div className={styles.scopeName}>{scope.name}</div>
                {vars.length === 0 ? (
                  <div className={styles.placeholderSmall}>(empty)</div>
                ) : (
                  <ul className={styles.varList}>
                    {vars.map((v, i) => (
                      <li key={`${v.name}-${i}`} className={styles.varRow} title={v.type}>
                        <span className={styles.varName}>{v.name}</span>
                        <span className={styles.varValue}>{v.value}</span>
                        {v.type && <span className={styles.varType}>{v.type}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className={styles.outputSection}>
        <div className={styles.sectionLabel}>Output</div>
        {output.length === 0 ? (
          <div className={styles.placeholderSmall}>Debugger output appears here.</div>
        ) : (
          <pre className={styles.outputContent}>
            {output.map((o, i) => (
              <span key={i} className={categoryClass(o.category)}>{o.text}</span>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
