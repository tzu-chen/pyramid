import type { SessionFile } from '../../types';
import { DiamondIcon } from '../Icons/Icons';
import styles from './WelcomeScreen.module.css';

interface WelcomeScreenProps {
  files: SessionFile[];
  onOpenFile: (id: string) => void;
}

const labelFor = (filename: string) => {
  const idx = filename.lastIndexOf('/');
  return idx >= 0 ? filename.slice(idx + 1) : filename;
};

const dirOf = (filename: string) => {
  const idx = filename.lastIndexOf('/');
  return idx >= 0 ? filename.slice(0, idx) : '';
};

/**
 * Blank-state shown in the editor area when no file tab is open — the IDE
 * "welcome" page. Lists the session's files so the user can reopen one even in
 * session types (Lean) that have no file tree.
 */
export default function WelcomeScreen({ files, onOpenFile }: WelcomeScreenProps) {
  return (
    <div className={styles.welcome}>
      <div className={styles.inner}>
        <h2 className={styles.heading}>No file open</h2>
        <p className={styles.subtitle}>
          Open a file to start editing.
        </p>
        {files.length > 0 ? (
          <div className={styles.fileList}>
            {files.map((file) => (
              <button
                key={file.id}
                className={styles.fileItem}
                onClick={() => onOpenFile(file.id)}
                title={file.filename}
              >
                <span className={styles.fileIcon}><DiamondIcon size={8} /></span>
                <span className={styles.fileName}>{labelFor(file.filename)}</span>
                {dirOf(file.filename) && (
                  <span className={styles.fileDir}>{dirOf(file.filename)}</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.subtitle}>This session has no files yet.</p>
        )}
      </div>
    </div>
  );
}
