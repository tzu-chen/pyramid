import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CpProblem } from '../../types';
import { cpService } from '../../services/cpService';
import Badge from '../../components/Badge/Badge';
import styles from './CpPage.module.css';

function getVerdictVariant(verdict: string): 'success' | 'danger' | 'warning' | 'default' {
  switch (verdict) {
    case 'accepted': return 'success';
    case 'wrong_answer':
    case 'runtime_error':
    case 'time_limit': return 'danger';
    case 'attempted': return 'warning';
    default: return 'default';
  }
}

function CpPage() {
  const [problems, setProblems] = useState<CpProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [judgeFilter, setJudgeFilter] = useState('');
  const [verdictFilter, setVerdictFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    cpService.listProblems({
      judge: judgeFilter || undefined,
      verdict: verdictFilter || undefined,
    }).then(data => {
      setProblems(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [judgeFilter, verdictFilter]);

  const solvedCount = problems.filter(p => p.verdict === 'accepted').length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Competitive Programming</h1>
        <Link to="/sessions/new" className={styles.createButton}>New CP Session</Link>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryValue}>{problems.length}</span>
          <span className={styles.summaryLabel}>Total</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryValue}>{solvedCount}</span>
          <span className={styles.summaryLabel}>Solved</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryValue}>
            {problems.length > 0 ? `${Math.round(solvedCount / problems.length * 100)}%` : '0%'}
          </span>
          <span className={styles.summaryLabel}>Rate</span>
        </div>
      </div>

      <div className={styles.filters}>
        <select className={styles.filterSelect} value={judgeFilter} onChange={e => setJudgeFilter(e.target.value)}>
          <option value="">All Judges</option>
          <option value="codeforces">Codeforces</option>
          <option value="atcoder">AtCoder</option>
          <option value="leetcode">LeetCode</option>
          <option value="other">Other</option>
        </select>
        <select className={styles.filterSelect} value={verdictFilter} onChange={e => setVerdictFilter(e.target.value)}>
          <option value="">All Verdicts</option>
          <option value="accepted">Accepted</option>
          <option value="wrong_answer">Wrong Answer</option>
          <option value="time_limit">Time Limit</option>
          <option value="runtime_error">Runtime Error</option>
          <option value="attempted">Attempted</option>
          <option value="unsolved">Unsolved</option>
        </select>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : problems.length === 0 ? (
        <div className={styles.empty}>No problems yet. Create a CP session to get started.</div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span className={styles.colJudge}>Judge</span>
            <span className={styles.colId}>ID</span>
            <span className={styles.colName}>Name</span>
            <span className={styles.colDifficulty}>Diff</span>
            <span className={styles.colVerdict}>Verdict</span>
            <span className={styles.colAttempts}>Att</span>
          </div>
          {problems.map(p => (
            <Link key={p.id} to={`/sessions/${p.session_id}`} className={styles.tableRow}>
              <span className={styles.colJudge}><Badge label={p.judge} /></span>
              <span className={styles.colId}>{p.problem_id}</span>
              <span className={styles.colName}>{p.problem_name || p.session_title || '-'}</span>
              <span className={styles.colDifficulty}>{p.difficulty || '-'}</span>
              <span className={styles.colVerdict}>
                <Badge label={p.verdict} variant={getVerdictVariant(p.verdict)} />
              </span>
              <span className={styles.colAttempts}>{p.attempts}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default CpPage;
