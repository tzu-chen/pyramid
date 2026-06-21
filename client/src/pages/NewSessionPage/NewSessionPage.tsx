import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SessionType } from '../../types';
import { sessionService } from '../../services/sessionService';
import styles from './NewSessionPage.module.css';

// Language each type runs as (mirrors the server's languageForType).
const LANGUAGE_FOR_TYPE: Record<SessionType, string> = {
  python: 'python',
  cpp: 'cpp',
  ocaml: 'ocaml',
  julia: 'julia',
  rust: 'rust',
  notebook: 'python',
  lean: 'lean',
};

// Offered interpreter versions for python/notebook sessions. '' = server default
// (the python_default_version setting, falling back to 3.12). uv downloads a
// managed build on demand if the version isn't already installed.
const PYTHON_VERSIONS = ['', '3.14', '3.13', '3.12', '3.11', '3.10'];

function NewSessionPage() {
  const navigate = useNavigate();
  const [sessionType, setSessionType] = useState<SessionType>('python');
  const [title, setTitle] = useState('');
  const [pythonVersion, setPythonVersion] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const showVersionPicker = sessionType === 'python' || sessionType === 'notebook';

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
        language: LANGUAGE_FOR_TYPE[sessionType],
        python_version: showVersionPicker && pythonVersion ? pythonVersion : undefined,
      });
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  };

  const typeOptions: { value: SessionType; label: string; description: string }[] = [
    { value: 'python', label: 'Python', description: 'Single-file Python computation and experimentation' },
    { value: 'cpp', label: 'C++', description: 'C++ with clangd, CMake builds, and Compiler Explorer' },
    { value: 'ocaml', label: 'OCaml', description: 'OCaml with ocamllsp, dune builds, and debugger' },
    { value: 'rust', label: 'Rust', description: 'Rust with rust-analyzer, Cargo builds/tests, clippy, crates, and debugger' },
    { value: 'julia', label: 'Julia', description: 'Single-file Julia computation and experimentation' },
    { value: 'notebook', label: 'Notebook', description: 'Jupyter notebook with cell-by-cell execution (Python)' },
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
                onClick={() => setSessionType(opt.value)}
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
              sessionType === 'lean' ? 'e.g., Hahn-Banach Theorem' :
              sessionType === 'notebook' ? 'e.g., Transformer attention analysis' :
              'e.g., SPDE finite element simulation'
            }
          />
        </div>

        {showVersionPicker && (
          <div className={styles.field}>
            <label className={styles.label}>Python Version</label>
            <select
              className={styles.input}
              value={pythonVersion}
              onChange={e => setPythonVersion(e.target.value)}
            >
              {PYTHON_VERSIONS.map(v => (
                <option key={v || 'default'} value={v}>{v ? v : 'Default'}</option>
              ))}
            </select>
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
