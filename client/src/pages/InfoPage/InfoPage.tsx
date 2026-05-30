import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  BackendsResponse,
  BackendInfo,
  BackendCategory,
  RunningSessionsResponse,
  RunningSessionInfo,
  RunningServiceInfo,
} from '../../types';
import { backendsService } from '../../services/backendsService';
import { RefreshIcon } from '../../components/Icons/Icons';
import styles from './InfoPage.module.css';

const CATEGORY_LABELS: Record<BackendCategory, string> = {
  language: 'Languages',
  lsp: 'Language Servers',
  build_tool: 'Build Tools',
  debugger: 'Debuggers',
  kernel: 'Kernels',
  project_tool: 'Project Tools',
};

const CATEGORY_ORDER: BackendCategory[] = ['language', 'lsp', 'build_tool', 'debugger', 'kernel', 'project_tool'];

function StatusDot({ status }: { status: BackendInfo['status'] }) {
  return <span className={`${styles.dot} ${styles[`dot_${status}`]}`} title={status} />;
}

function BackendCard({ backend }: { backend: BackendInfo }) {
  return (
    <div className={`${styles.card} ${backend.status === 'missing' ? styles.cardMissing : ''}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <StatusDot status={backend.status} />
          <span className={styles.cardName}>{backend.name}</span>
          <code className={styles.cardCommand}>{backend.command}</code>
        </div>
        {backend.version && <span className={styles.cardVersion}>{backend.version}</span>}
      </div>

      {backend.status === 'missing' && (
        <div className={styles.notInstalled}>Not installed (or not on PATH)</div>
      )}

      {backend.path && (
        <div className={styles.row}>
          <span className={styles.rowLabel}>Path</span>
          <code className={styles.rowValue}>{backend.path}</code>
        </div>
      )}

      {backend.used_for.length > 0 && (
        <div className={styles.row}>
          <span className={styles.rowLabel}>Used for</span>
          <ul className={styles.usedList}>
            {backend.used_for.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </div>
      )}

      {backend.error && (
        <div className={styles.error}>{backend.error}</div>
      )}
    </div>
  );
}

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

function InfoPage() {
  const [data, setData] = useState<BackendsResponse | null>(null);
  const [running, setRunning] = useState<RunningSessionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([backendsService.list(), backendsService.listRunning()])
      .then(([b, r]) => { setData(b); setRunning(r); })
      .catch(err => setError(err.message || 'Failed to fetch backends'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = (data?.backends ?? []).reduce<Record<BackendCategory, BackendInfo[]>>((acc, b) => {
    if (!acc[b.category]) acc[b.category] = [];
    acc[b.category].push(b);
    return acc;
  }, { language: [], lsp: [], build_tool: [], debugger: [], kernel: [], project_tool: [] });

  const availableCount = data?.backends.filter(b => b.status === 'available').length ?? 0;
  const missingCount = data?.backends.filter(b => b.status === 'missing').length ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Info</h1>
          <p className={styles.subtitle}>
            Backends Pyramid uses to run sessions, language servers, and build tools.
          </p>
        </div>
        <button className={styles.refreshBtn} onClick={load} disabled={loading} title="Re-probe backends">
          <RefreshIcon size={14} />
          <span>{loading ? 'Probing…' : 'Refresh'}</span>
        </button>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {data && (
        <div className={styles.summary}>
          <div className={styles.summaryItem}>
            <div className={styles.summaryValue}>{availableCount}</div>
            <div className={styles.summaryLabel}>Available</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryValue}>{missingCount}</div>
            <div className={styles.summaryLabel}>Missing</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryValueSmall}>{data.node_version}</div>
            <div className={styles.summaryLabel}>Node.js</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryValueSmall}>{data.platform}</div>
            <div className={styles.summaryLabel}>Platform</div>
          </div>
        </div>
      )}

      {loading && !data && <div className={styles.loading}>Probing installed backends…</div>}

      {running && (
        <section className={styles.section}>
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
        </section>
      )}

      {data && CATEGORY_ORDER.map(cat => {
        const items = grouped[cat];
        if (!items || items.length === 0) return null;
        return (
          <section key={cat} className={styles.section}>
            <h2 className={styles.sectionTitle}>{CATEGORY_LABELS[cat]}</h2>
            <div className={styles.grid}>
              {items.map(b => <BackendCard key={b.key} backend={b} />)}
            </div>
          </section>
        );
      })}

      {data && (
        <div className={styles.footnote}>
          Probed {new Date(data.checked_at).toLocaleString()}
        </div>
      )}
    </div>
  );
}

export default InfoPage;
