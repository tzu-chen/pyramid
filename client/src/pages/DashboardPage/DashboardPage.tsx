import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  StatsOverview,
  HeatmapEntry,
  RunningSessionsResponse,
  RunningSessionInfo,
  RunningServiceInfo,
} from '../../types';
import { statsService } from '../../services/statsService';
import { backendsService } from '../../services/backendsService';
import Heatmap from '../../components/Heatmap/Heatmap';
import Badge, { type BadgeVariant } from '../../components/Badge/Badge';
import styles from './DashboardPage.module.css';

function formatUptime(startedAt: number): string {
  const ms = Date.now() - startedAt;
  if (ms < 0) return '0s';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

const KIND_LABELS: Record<RunningServiceInfo['kind'], string> = {
  lsp: 'LSP',
  kernel: 'Kernel',
  dap: 'Debug',
  terminal: 'Terminal',
};

function ServiceRow({ svc }: { svc: RunningServiceInfo }) {
  return (
    <li className={styles.serviceRow}>
      <span className={`${styles.serviceKind} ${styles[`kind_${svc.kind}`]}`}>{KIND_LABELS[svc.kind]}</span>
      <span className={styles.serviceName}>{svc.name}</span>
      <code className={styles.serviceCommand}>{svc.command}</code>
      <span className={styles.serviceMeta}>
        {svc.pid !== null && <span>pid {svc.pid}</span>}
        <span>up {formatUptime(svc.started_at)}</span>
        {svc.client_count !== undefined && <span>{svc.client_count} client{svc.client_count === 1 ? '' : 's'}</span>}
        {svc.kind === 'kernel' && svc.ready === false && <span className={styles.notReady}>starting</span>}
        {svc.kind === 'terminal' && svc.cols !== undefined && <span>{svc.cols}×{svc.rows}</span>}
      </span>
    </li>
  );
}

function RunningSessionCard({ session }: { session: RunningSessionInfo }) {
  const title = session.title ?? `(unknown session ${session.session_id.slice(0, 8)})`;
  return (
    <div className={styles.runningCard}>
      <div className={styles.runningHeader}>
        <div className={styles.runningTitleRow}>
          <Link to={`/sessions/${session.session_id}`} className={styles.runningTitle}>{title}</Link>
          {session.session_type && <span className={styles.runningBadge}>{session.session_type}</span>}
          {session.language && <span className={styles.runningBadgeMuted}>{session.language}</span>}
        </div>
        <code className={styles.runningId}>{session.session_id.slice(0, 8)}</code>
      </div>
      <ul className={styles.serviceList}>
        {session.services.map((s, i) => <ServiceRow key={i} svc={s} />)}
      </ul>
    </div>
  );
}

function DashboardPage() {
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapEntry[]>([]);
  const [running, setRunning] = useState<RunningSessionsResponse | null>(null);

  useEffect(() => {
    statsService.getOverview().then(setOverview).catch(() => {});
    statsService.getHeatmap().then(setHeatmap).catch(() => {});
    backendsService.listRunning().then(setRunning).catch(() => {});
  }, []);

  const typeTotal = overview?.sessions_by_type.reduce((sum, s) => sum + s.count, 0) ?? 0;
  const sessionsByType = [...(overview?.sessions_by_type ?? [])].sort((a, b) => b.count - a.count);

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
      </div>

      {running && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Running Sessions
            <span className={styles.sectionCount}>
              {running.session_count} session{running.session_count === 1 ? '' : 's'} · {running.service_count} service{running.service_count === 1 ? '' : 's'}
            </span>
          </h2>
          {running.sessions.length === 0 ? (
            <div className={styles.emptyRunning}>No active LSP servers, kernels, debuggers, or terminals.</div>
          ) : (
            <div className={styles.runningList}>
              {running.sessions.map(s => <RunningSessionCard key={s.session_id} session={s} />)}
            </div>
          )}
        </div>
      )}

      {sessionsByType.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Sessions by Type</h2>
          <div className={styles.typeGrid}>
            {sessionsByType.map(s => {
              const pct = typeTotal > 0 ? Math.round((s.count / typeTotal) * 100) : 0;
              return (
                <Link
                  key={s.session_type}
                  to={`/sessions?type=${s.session_type}`}
                  className={`${styles.typeCard} ${styles[`accent_${s.session_type}`] ?? ''}`}
                >
                  <div className={styles.typeCardTop}>
                    <Badge label={s.session_type} variant={s.session_type as BadgeVariant} />
                    <span className={styles.typeCount}>{s.count}</span>
                  </div>
                  <div className={styles.typeBar}>
                    <div className={styles.typeBarFill} style={{ width: `${pct}%` }} />
                  </div>
                  <div className={styles.typePct}>{pct}% of all sessions</div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Activity (Last 90 Days)</h2>
        <Heatmap data={heatmap} />
      </div>
    </div>
  );
}

export default DashboardPage;
