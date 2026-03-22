import { useState, useMemo, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSessions } from '../../hooks/useSessions';
import { useDebounce } from '../../hooks/useDebounce';
import { sessionService } from '../../services/sessionService';
import Badge from '../../components/Badge/Badge';
import { PencilIcon, TrashIcon, CheckIcon, XIcon } from '../../components/Icons/Icons';
import styles from './SessionListPage.module.css';

function SessionListPage() {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const params = useMemo(() => ({
    session_type: typeFilter || undefined,
    status: statusFilter || undefined,
    language: languageFilter || undefined,
    search: debouncedSearch || undefined,
  }), [typeFilter, statusFilter, languageFilter, debouncedSearch]);

  const { sessions, loading, refresh } = useSessions(params);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleRenameStart = (id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle);
    setDeletingId(null);
  };

  const handleRenameConfirm = async () => {
    if (!renamingId || !renameValue.trim()) return;
    try {
      await sessionService.update(renamingId, { title: renameValue.trim() });
      setRenamingId(null);
      refresh();
    } catch {
      // keep editing on error
    }
  };

  const handleRenameCancel = () => {
    setRenamingId(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameConfirm();
    } else if (e.key === 'Escape') {
      handleRenameCancel();
    }
  };

  const handleDeleteStart = (id: string) => {
    setDeletingId(id);
    setRenamingId(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    try {
      await sessionService.remove(deletingId);
      setDeletingId(null);
      refresh();
    } catch {
      // keep confirmation visible on error
    }
  };

  const handleDeleteCancel = () => {
    setDeletingId(null);
  };

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
            <div key={session.id} className={styles.sessionItem}>
              {deletingId === session.id ? (
                <div className={styles.confirmBar}>
                  <span className={styles.confirmText}>Delete this session?</span>
                  <button className={`${styles.iconButton} ${styles.iconButtonDanger}`} onClick={handleDeleteConfirm} title="Confirm delete">
                    <CheckIcon size={14} />
                  </button>
                  <button className={styles.iconButton} onClick={handleDeleteCancel} title="Cancel">
                    <XIcon size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <div className={styles.sessionContent} onClick={() => navigate(`/sessions/${session.id}`)}>
                    <div className={styles.sessionInfo}>
                      {renamingId === session.id ? (
                        <input
                          ref={renameInputRef}
                          className={styles.renameInput}
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={handleRenameKeyDown}
                          onBlur={handleRenameConfirm}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className={styles.sessionTitle}>{session.title}</span>
                      )}
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
                  </div>
                  <div className={styles.sessionActions}>
                    <button
                      className={styles.iconButton}
                      onClick={e => { e.stopPropagation(); handleRenameStart(session.id, session.title); }}
                      title="Rename"
                    >
                      <PencilIcon size={14} />
                    </button>
                    <button
                      className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                      onClick={e => { e.stopPropagation(); handleDeleteStart(session.id); }}
                      title="Delete"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SessionListPage;
