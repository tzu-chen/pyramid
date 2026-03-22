import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SessionType } from '../../types';
import { sessionService } from '../../services/sessionService';
import styles from './NewSessionPage.module.css';

function NewSessionPage() {
  const navigate = useNavigate();
  const [sessionType, setSessionType] = useState<SessionType>('freeform');
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('python');
  const [problemUrl, setProblemUrl] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const session = await sessionService.create({
        title: title.trim(),
        session_type: sessionType,
        language,
        problem_url: sessionType === 'cp' ? problemUrl : undefined,
        repo_url: sessionType === 'repo' ? repoUrl : undefined,
      });
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  };

  const typeOptions: { value: SessionType; label: string; description: string }[] = [
    { value: 'freeform', label: 'Freeform', description: 'Open-ended computation and experimentation' },
    { value: 'cp', label: 'CP', description: 'Competitive programming practice' },
    { value: 'repo', label: 'Repo', description: 'GitHub repository exploration' },
    { value: 'lean', label: 'Lean', description: 'Formal proof writing in Lean 4' },
  ];

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>New Session</h1>

      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label}>Session Type</label>
          <div className={styles.typeGrid}>
            {typeOptions.map(opt => (
              <button
                key={opt.value}
                className={`${styles.typeOption} ${sessionType === opt.value ? styles.typeSelected : ''}`}
                onClick={() => {
                  setSessionType(opt.value);
                  if (opt.value === 'lean') setLanguage('lean');
                  else if (language === 'lean') setLanguage('python');
                }}
              >
                <strong>{opt.label}</strong>
                <span className={styles.typeDesc}>{opt.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Title</label>
          <input
            className={styles.input}
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={
              sessionType === 'cp' ? 'e.g., Codeforces 1900A' :
              sessionType === 'repo' ? 'e.g., Explore: pytorch' :
              sessionType === 'lean' ? 'e.g., Hahn-Banach Theorem' :
              'e.g., SPDE finite element simulation'
            }
          />
        </div>

        {sessionType !== 'lean' && (
          <div className={styles.field}>
            <label className={styles.label}>Language</label>
            <select className={styles.select} value={language} onChange={e => setLanguage(e.target.value)}>
              <option value="python">Python</option>
              <option value="cpp">C++</option>
              <option value="julia">Julia</option>
            </select>
          </div>
        )}

        {sessionType === 'cp' && (
          <div className={styles.field}>
            <label className={styles.label}>Problem URL (optional)</label>
            <input
              className={styles.input}
              type="url"
              value={problemUrl}
              onChange={e => setProblemUrl(e.target.value)}
              placeholder="https://codeforces.com/contest/1900/problem/A"
            />
          </div>
        )}

        {sessionType === 'repo' && (
          <div className={styles.field}>
            <label className={styles.label}>GitHub URL</label>
            <input
              className={styles.input}
              type="url"
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
            />
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}

        <button className={styles.createButton} onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating...' : 'Create Session'}
        </button>
      </div>
    </div>
  );
}

export default NewSessionPage;
