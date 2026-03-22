import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import styles from './GoalStatePanel.module.css';

interface GoalStatePanelProps {
  goalState: string | null;
  connected: boolean;
  initialized: boolean;
}

function renderMathInText(text: string): string {
  // Render inline LaTeX between $ delimiters
  return text.replace(/\$([^$]+)\$/g, (_, expr) => {
    try {
      return katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return expr;
    }
  });
}

function parseGoalState(raw: string): { goals: { hypotheses: string[]; target: string }[] } | null {
  if (!raw || raw.trim() === '') return null;

  const goals: { hypotheses: string[]; target: string }[] = [];
  // Split by goal separators (multiple goals separated by blank lines or "case" headers)
  const goalBlocks = raw.split(/\n(?=case\s|\d+\s+goal)/);

  for (const block of goalBlocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    const hypotheses: string[] = [];
    let target = '';
    let foundTurnstile = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' && !foundTurnstile) continue;

      // The turnstile separator
      if (trimmed.startsWith('\u22A2') || trimmed.startsWith('|-') || trimmed.startsWith('⊢')) {
        foundTurnstile = true;
        target = trimmed.replace(/^[⊢||-]+\s*/, '');
        continue;
      }

      if (foundTurnstile) {
        // Lines after turnstile are continuation of target
        target += '\n' + trimmed;
      } else {
        hypotheses.push(trimmed);
      }
    }

    if (foundTurnstile || hypotheses.length > 0) {
      goals.push({ hypotheses, target: target.trim() });
    } else {
      // Treat entire block as a single message
      goals.push({ hypotheses: [], target: block.trim() });
    }
  }

  return goals.length > 0 ? { goals } : null;
}

function GoalStatePanel({ goalState, connected, initialized }: GoalStatePanelProps) {
  const parsed = useMemo(() => {
    if (!goalState) return null;

    // Check for "no goals" or "proof complete" messages
    const lower = goalState.toLowerCase().trim();
    if (lower === 'no goals' || lower.includes('goals accomplished')) {
      return 'complete';
    }

    return parseGoalState(goalState);
  }, [goalState]);

  if (!connected) {
    return (
      <div className={styles.panel}>
        <div className={styles.status}>Connecting to Lean server...</div>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className={styles.panel}>
        <div className={styles.status}>Initializing Lean server...</div>
      </div>
    );
  }

  if (parsed === 'complete') {
    return (
      <div className={styles.panel}>
        <div className={styles.complete}>Proof complete</div>
      </div>
    );
  }

  if (!parsed || !goalState) {
    return (
      <div className={styles.panel}>
        <div className={styles.noGoals}>No goals</div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {parsed.goals.map((goal, i) => (
        <div key={i} className={styles.goal}>
          {parsed.goals.length > 1 && (
            <div className={styles.goalHeader}>Goal {i + 1} of {parsed.goals.length}</div>
          )}
          {goal.hypotheses.length > 0 && (
            <div className={styles.hypotheses}>
              {goal.hypotheses.map((h, j) => (
                <div
                  key={j}
                  className={styles.hypothesis}
                  dangerouslySetInnerHTML={{ __html: renderMathInText(h) }}
                />
              ))}
            </div>
          )}
          {goal.target && (
            <>
              <div className={styles.turnstile}>{'\u22A2'}</div>
              <div
                className={styles.target}
                dangerouslySetInnerHTML={{ __html: renderMathInText(goal.target) }}
              />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export default GoalStatePanel;
