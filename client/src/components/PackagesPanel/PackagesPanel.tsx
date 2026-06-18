import { useCallback, useEffect, useState } from 'react';
import { pythonEnvService } from '../../services/pythonEnvService';
import type { PackageList } from '../../types';
import styles from './PackagesPanel.module.css';

interface PackagesPanelProps {
  sessionId: string;
  // Bump to force a re-fetch (e.g. after an external "install missing module").
  refreshKey?: number;
}

export default function PackagesPanel({ sessionId, refreshKey }: PackagesPanelProps) {
  const [pkgs, setPkgs] = useState<PackageList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [dev, setDev] = useState(false);
  const [showInstalled, setShowInstalled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPkgs(await pythonEnvService.getPackages(sessionId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Run a uv mutation, replacing the package list with its result.
  const run = useCallback(async (op: () => Promise<PackageList>) => {
    setBusy(true);
    setError(null);
    try {
      setPkgs(await op());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleAdd = () => {
    const name = input.trim();
    if (!name) return;
    setInput('');
    run(() => pythonEnvService.addPackage(sessionId, name, dev));
  };

  if (loading) return <div className={styles.root}><div className={styles.placeholder}>Loading packages…</div></div>;

  return (
    <div className={styles.root}>
      <div className={styles.headerRow}>
        <span className={styles.title}>Packages</span>
        <span className={`${styles.lockPill} ${pkgs?.lockPresent ? styles.lockOk : styles.lockNone}`}>
          {pkgs?.lockPresent ? 'uv.lock' : 'no lock'}
        </span>
        <div className={styles.headerActions}>
          <button className={styles.smallButton} disabled={busy} onClick={() => run(() => pythonEnvService.sync(sessionId))}>Sync</button>
          <button className={styles.smallButton} disabled={busy} onClick={() => run(() => pythonEnvService.lock(sessionId))}>Lock now</button>
        </div>
      </div>

      <div className={styles.addRow}>
        <input
          className={styles.input}
          placeholder="package (e.g. numpy>=2.0)"
          value={input}
          disabled={busy}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
        />
        <label className={styles.devToggle} title="Add as a development dependency">
          <input type="checkbox" checked={dev} disabled={busy} onChange={e => setDev(e.target.checked)} />
          dev
        </label>
        <button className={styles.addButton} disabled={busy || !input.trim()} onClick={handleAdd}>Add</button>
      </div>

      {busy && <div className={styles.busy}>Running uv…</div>}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Dependencies</div>
        {pkgs && pkgs.declared.length > 0 ? (
          <ul className={styles.depList}>
            {pkgs.declared.map(d => (
              <li key={`${d.group}:${d.name}`} className={styles.depItem}>
                <span className={styles.depName}>{d.spec}</span>
                {d.group === 'dev' && <span className={styles.devTag}>dev</span>}
                <button
                  className={styles.removeButton}
                  disabled={busy}
                  title={`Remove ${d.name}`}
                  onClick={() => run(() => pythonEnvService.removePackage(sessionId, d.name))}
                >✕</button>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.placeholderSmall}>No declared dependencies yet. Add one above.</div>
        )}
      </div>

      <div className={styles.section}>
        <button className={styles.installedToggle} onClick={() => setShowInstalled(v => !v)}>
          {showInstalled ? '▾' : '▸'} Installed ({pkgs?.installed.length ?? 0})
        </button>
        {showInstalled && pkgs && (
          <ul className={styles.installedList}>
            {pkgs.installed.map(p => (
              <li key={p.name} className={styles.installedItem}>
                <span className={styles.installedName}>{p.name}</span>
                <span className={styles.installedVersion}>{p.version}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
