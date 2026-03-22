import { useState, useEffect } from 'react';
import { FileTreeEntry } from '../../types';
import { repoService } from '../../services/repoService';
import styles from './FileTree.module.css';

interface FileTreeProps {
  repoId: string;
  onFileSelect: (path: string) => void;
}

interface TreeNodeProps {
  entry: FileTreeEntry;
  repoId: string;
  onFileSelect: (path: string) => void;
}

function TreeNode({ entry, repoId, onFileSelect }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileTreeEntry[]>([]);

  const handleClick = async () => {
    if (entry.type === 'directory') {
      if (!expanded && children.length === 0) {
        const items = await repoService.getTree(repoId, entry.path);
        setChildren(items);
      }
      setExpanded(!expanded);
    } else {
      onFileSelect(entry.path);
    }
  };

  return (
    <div>
      <button className={`${styles.node} ${entry.type === 'file' ? styles.file : ''}`} onClick={handleClick}>
        <span className={styles.icon}>
          {entry.type === 'directory' ? (expanded ? 'v' : '>') : ' '}
        </span>
        <span className={styles.name}>{entry.name}</span>
      </button>
      {expanded && children.length > 0 && (
        <div className={styles.children}>
          {children.map(child => (
            <TreeNode key={child.path} entry={child} repoId={repoId} onFileSelect={onFileSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileTree({ repoId, onFileSelect }: FileTreeProps) {
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);

  useEffect(() => {
    repoService.getTree(repoId).then(setEntries).catch(() => {});
  }, [repoId]);

  return (
    <div className={styles.tree}>
      {entries.map(entry => (
        <TreeNode key={entry.path} entry={entry} repoId={repoId} onFileSelect={onFileSelect} />
      ))}
      {entries.length === 0 && (
        <div className={styles.empty}>No files found</div>
      )}
    </div>
  );
}

export default FileTree;
