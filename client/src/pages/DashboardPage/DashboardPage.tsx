import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { StatsOverview, HeatmapEntry, Session } from '../../types';
import { statsService } from '../../services/statsService';
import { sessionService } from '../../services/sessionService';
import Heatmap from '../../components/Heatmap/Heatmap';
import Badge from '../../components/Badge/Badge';
import styles from './DashboardPage.module.css';

function DashboardPage() {
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapEntry[]>([]);
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);

  useEffect(() => {
    statsService.getOverview().then(setOverview).catch(() => {});
    statsService.getHeatmap().then(setHeatmap).catch(() => {});
    sessionService.list({ status: 'active' }).then(s => setRecentSessions(s.slice(0, 10))).catch(() => {});
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Dashboard</h1>
        <div className={styles.actions}>
          <Link to="/sessions/new" className={styles.createButton}>New Session</Link>
        </div>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{overview?.active_count ?? 0}</div>
          <div className={styles.statLabel}>Active Sessions</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{overview?.total_runs ?? 0}</div>
          <div className={styles.statLabel}>Total Runs</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{overview?.cp_solved ?? 0}/{overview?.cp_total ?? 0}</div>
          <div className={styles.statLabel}>CP Solved</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{overview ? `${Math.round(overview.cp_solve_rate * 100)}%` : '0%'}</div>
          <div className={styles.statLabel}>CP Solve Rate</div>
        </div>
      </div>

      {overview && overview.sessions_by_type.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Sessions by Type</h2>
          <div className={styles.typeGrid}>
            {overview.sessions_by_type.map(s => (
              <div key={s.session_type} className={styles.typeCard}>
                <Badge label={s.session_type} variant={s.session_type as 'freeform' | 'cp' | 'repo' | 'lean'} />
                <span className={styles.typeCount}>{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Activity (Last 90 Days)</h2>
        <Heatmap data={heatmap} />
      </div>

      {recentSessions.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Active Sessions</h2>
          <div className={styles.sessionList}>
            {recentSessions.map(session => (
              <Link key={session.id} to={`/sessions/${session.id}`} className={styles.sessionItem}>
                <div className={styles.sessionInfo}>
                  <span className={styles.sessionTitle}>{session.title}</span>
                  <div className={styles.sessionMeta}>
                    <Badge label={session.session_type} variant={session.session_type as 'freeform' | 'cp' | 'repo' | 'lean'} />
                    <Badge label={session.language} />
                  </div>
                </div>
                <span className={styles.sessionDate}>
                  {new Date(session.updated_at).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardPage;
