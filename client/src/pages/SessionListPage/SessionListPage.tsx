import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSessions } from '../../hooks/useSessions';
import { useDebounce } from '../../hooks/useDebounce';
import Badge from '../../components/Badge/Badge';
import styles from './SessionListPage.module.css';

function SessionListPage() {
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);

  const params = useMemo(() => ({
    session_type: typeFilter || undefined,
    status: statusFilter || undefined,
    language: languageFilter || undefined,
    search: debouncedSearch || undefined,
  }), [typeFilter, statusFilter, languageFilter, debouncedSearch]);

  const { sessions, loading } = useSessions(params);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Sessions</h1>
        <Link to="/sessions/new" className={styles.createButton}>New Session</Link>
      </div>

      <div className={styles.filters}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search sessions..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
        />
        <select className={styles.filterSelect} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="freeform">Freeform</option>
          <option value="cp">CP</option>
          <option value="repo">Repo</option>
          <option value="lean">Lean</option>
        </select>
        <select className={styles.filterSelect} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
        <select className={styles.filterSelect} value={languageFilter} onChange={e => setLanguageFilter(e.target.value)}>
          <option value="">All Languages</option>
          <option value="python">Python</option>
          <option value="julia">Julia</option>
          <option value="cpp">C++</option>
          <option value="lean">Lean</option>
        </select>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : sessions.length === 0 ? (
        <div className={styles.empty}>
          No sessions found. <Link to="/sessions/new">Create one</Link>
        </div>
      ) : (
        <div className={styles.sessionList}>
          {sessions.map(session => (
            <Link key={session.id} to={`/sessions/${session.id}`} className={styles.sessionItem}>
              <div className={styles.sessionInfo}>
                <span className={styles.sessionTitle}>{session.title}</span>
                <div className={styles.sessionMeta}>
                  <Badge label={session.session_type} variant={session.session_type as 'freeform' | 'cp' | 'repo' | 'lean'} />
                  <Badge label={session.language} />
                  <Badge label={session.status} variant={session.status === 'active' ? 'success' : session.status === 'archived' ? 'default' : 'warning'} />
                  {session.tags.map(tag => (
                    <Badge key={tag} label={tag} />
                  ))}
                </div>
              </div>
              <span className={styles.sessionDate}>
                {new Date(session.updated_at).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default SessionListPage;
