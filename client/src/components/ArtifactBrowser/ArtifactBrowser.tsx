import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cppBuildService,
  type ArtifactNode,
  type ArtifactKind,
  type ArtifactTextResult,
} from '../../services/cppBuildService';
import { ChevronRightIcon, ChevronDownIcon, DiamondIcon } from '../Icons/Icons';
import styles from './ArtifactBrowser.module.css';

interface ArtifactBrowserProps {
  sessionId: string;
  // Bumped by SessionPage after a successful build to force a reload.
  refreshKey: number;
}

const KIND_LABEL: Record<ArtifactKind, string> = {
  dir: 'dir',
  executable: 'exe',
  object: 'obj',
  archive: 'lib',
  shared_lib: 'so',
  compile_commands: 'json',
  cmake: 'cmake',
  text: 'text',
  binary: 'bin',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Files we can usefully render inline. Binaries get a download link instead.
function isInlineViewable(kind: ArtifactKind): boolean {
  return kind === 'compile_commands' || kind === 'text' || kind === 'cmake';
}

function flattenAll(nodes: ArtifactNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: ArtifactNode[]) => {
    for (const n of ns) {
      if (n.isDir) {
        out.push(n.path);
        if (n.children) walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}

interface ViewerState {
  path: string;
  name: string;
  kind: ArtifactKind;
  result: ArtifactTextResult | null;
  loading: boolean;
  error: string | null;
}

export default function ArtifactBrowser({ sessionId, refreshKey }: ArtifactBrowserProps) {
  const [tree, setTree] = useState<ArtifactNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { tree: t } = await cppBuildService.artifactTree(sessionId);
      setTree(t);
      // First load: expand top-level flavor dirs (Debug, Release, …).
      setExpanded((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<string>();
        for (const n of t) if (n.isDir) next.add(n.path);
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { reload(); }, [reload, refreshKey]);

  const toggle = useCallback((p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(flattenAll(tree)));
  }, [tree]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const openFile = useCallback(async (node: ArtifactNode) => {
    if (node.isDir) return;
    if (!isInlineViewable(node.kind)) {
      // For binaries, executables, objects, archives — download in a new tab.
      const url = cppBuildService.artifactDownloadUrl(sessionId, node.path);
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    setViewer({ path: node.path, name: node.name, kind: node.kind, result: null, loading: true, error: null });
    try {
      const result = await cppBuildService.artifactText(sessionId, node.path);
      setViewer({ path: node.path, name: node.name, kind: node.kind, result, loading: false, error: null });
    } catch (e) {
      setViewer({ path: node.path, name: node.name, kind: node.kind, result: null, loading: false, error: (e as Error).message });
    }
  }, [sessionId]);

  const totalCount = useMemo(() => {
    let n = 0;
    const walk = (ns: ArtifactNode[]) => {
      for (const e of ns) {
        n++;
        if (e.children) walk(e.children);
      }
    };
    walk(tree);
    return n;
  }, [tree]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>build/</div>
        <div className={styles.headerActions}>
          <span className={styles.headerMeta}>{totalCount} {totalCount === 1 ? 'entry' : 'entries'}</span>
          <button className={styles.btn} onClick={expandAll} disabled={tree.length === 0}>Expand</button>
          <button className={styles.btn} onClick={collapseAll} disabled={tree.length === 0}>Collapse</button>
          <button className={styles.btn} onClick={reload} disabled={loading}>{loading ? '…' : 'Refresh'}</button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {tree.length === 0 && !loading && !error && (
        <div className={styles.empty}>
          No build artifacts yet. Click <strong>Build</strong> to populate <code>build/</code>.
        </div>
      )}

      {tree.length > 0 && (
        <div className={styles.tree}>
          {tree.map((n) => (
            <ArtifactRow
              key={n.path}
              node={n}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              onOpen={openFile}
              activePath={viewer?.path ?? null}
            />
          ))}
        </div>
      )}

      {viewer && (
        <div className={styles.viewer}>
          <div className={styles.viewerHeader}>
            <span className={styles.viewerPath} title={viewer.path}>{viewer.path}</span>
            <span className={styles.viewerKind}>{KIND_LABEL[viewer.kind]}</span>
            {viewer.result?.truncated && (
              <span className={styles.viewerTruncated}>truncated · {formatSize(viewer.result.size)}</span>
            )}
            <a
              className={styles.viewerDownload}
              href={cppBuildService.artifactDownloadUrl(sessionId, viewer.path)}
              target="_blank"
              rel="noopener noreferrer"
            >
              download
            </a>
            <button className={styles.viewerClose} onClick={() => setViewer(null)} title="Close">×</button>
          </div>
          {viewer.loading && <div className={styles.viewerLoading}>Loading…</div>}
          {viewer.error && <div className={styles.error}>{viewer.error}</div>}
          {viewer.result && (
            <pre className={styles.viewerContent}>{viewer.result.content}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function kindClass(kind: ArtifactKind): string {
  switch (kind) {
    case 'executable':       return styles.kindExecutable;
    case 'object':           return styles.kindObject;
    case 'archive':          return styles.kindArchive;
    case 'shared_lib':       return styles.kindShared;
    case 'compile_commands': return styles.kindCompileCommands;
    case 'cmake':            return styles.kindCmake;
    case 'text':             return styles.kindText;
    case 'binary':           return styles.kindBinary;
    default:                 return '';
  }
}

interface ArtifactRowProps {
  node: ArtifactNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (p: string) => void;
  onOpen: (n: ArtifactNode) => void;
  activePath: string | null;
}

function ArtifactRow({ node, depth, expanded, onToggle, onOpen, activePath }: ArtifactRowProps) {
  const isOpen = expanded.has(node.path);
  const isActive = !node.isDir && node.path === activePath;
  const hasChildren = !!node.children && node.children.length > 0;

  const handleClick = () => {
    if (node.isDir) onToggle(node.path);
    else onOpen(node);
  };

  return (
    <>
      <div
        className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={handleClick}
        title={node.path}
      >
        <span className={styles.rowIcon}>
          {node.isDir ? (
            isOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />
          ) : (
            <DiamondIcon size={8} />
          )}
        </span>
        <span className={styles.rowName}>{node.name}</span>
        <span className={`${styles.rowKind} ${kindClass(node.kind)}`}>{KIND_LABEL[node.kind]}</span>
        {!node.isDir && <span className={styles.rowSize}>{formatSize(node.size)}</span>}
        {node.isDir && hasChildren && <span className={styles.rowSize}>{node.children!.length}</span>}
      </div>
      {node.isDir && isOpen && hasChildren && node.children!.map((c) => (
        <ArtifactRow
          key={c.path}
          node={c}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onOpen={onOpen}
          activePath={activePath}
        />
      ))}
    </>
  );
}
