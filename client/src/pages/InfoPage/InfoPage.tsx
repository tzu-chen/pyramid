import { useEffect, useState, useCallback } from 'react';
import { BackendsResponse, BackendInfo, BackendCategory } from '../../types';
import { backendsService } from '../../services/backendsService';
import { RefreshIcon } from '../../components/Icons/Icons';
import styles from './InfoPage.module.css';

const CATEGORY_LABELS: Record<BackendCategory, string> = {
  language: 'Languages',
  lsp: 'Language Servers',
  build_tool: 'Build Tools',
  kernel: 'Kernels',
  project_tool: 'Project Tools',
};

const CATEGORY_ORDER: BackendCategory[] = ['language', 'lsp', 'build_tool', 'kernel', 'project_tool'];

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

function InfoPage() {
  const [data, setData] = useState<BackendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    backendsService.list()
      .then(setData)
      .catch(err => setError(err.message || 'Failed to fetch backends'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = (data?.backends ?? []).reduce<Record<BackendCategory, BackendInfo[]>>((acc, b) => {
    if (!acc[b.category]) acc[b.category] = [];
    acc[b.category].push(b);
    return acc;
  }, { language: [], lsp: [], build_tool: [], kernel: [], project_tool: [] });

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
