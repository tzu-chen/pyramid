import type { SessionFile } from '../../types';
import styles from './FileTabs.module.css';

interface FileTabsProps {
  files: SessionFile[];
  openFileIds: string[];
  activeFileId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export default function FileTabs({ files, openFileIds, activeFileId, onSelect, onClose }: FileTabsProps) {
  if (openFileIds.length === 0) return null;

  const labelFor = (filename: string) => {
    const idx = filename.lastIndexOf('/');
    return idx >= 0 ? filename.slice(idx + 1) : filename;
  };

  return (
    <div className={styles.tabs}>
      {openFileIds.map((fid) => {
        const file = files.find((f) => f.id === fid);
        if (!file) return null;
        const active = activeFileId === fid;
        return (
          <div
            key={fid}
            className={`${styles.tab} ${active ? styles.tabActive : ''}`}
            onClick={() => onSelect(fid)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(fid);
              }
            }}
            title={file.filename}
          >
            <span className={styles.tabLabel}>{labelFor(file.filename)}</span>
            <button
              className={styles.tabClose}
              onClick={(e) => {
                e.stopPropagation();
                onClose(fid);
              }}
              title="Close"
              aria-label={`Close ${file.filename}`}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
