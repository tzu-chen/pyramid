import { useState, useCallback, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { fileService } from '../../services/fileService';
import { SessionFile } from '../../types';
import { ChevronRightIcon, ChevronDownIcon, DiamondIcon, PlusIcon } from '../Icons/Icons';
import styles from './FileTree.module.css';

// ── Tree data structures ──

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: SessionFile;
}

function buildTree(treePaths: string[], files: SessionFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();
  const fileMap = new Map<string, SessionFile>();

  for (const f of files) {
    fileMap.set(f.filename, f);
  }

  for (const entry of treePaths) {
    const isDir = entry.endsWith('/');
    const cleanPath = isDir ? entry.slice(0, -1) : entry;
    const parts = cleanPath.split('/');
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join('/');

    const node: TreeNode = {
      name,
      path: cleanPath,
      isDir,
      children: [],
      file: isDir ? undefined : fileMap.get(cleanPath),
    };

    if (isDir) {
      dirMap.set(cleanPath, node);
    }

    if (parentPath && dirMap.has(parentPath)) {
      dirMap.get(parentPath)!.children.push(node);
    } else if (!parentPath) {
      root.push(node);
    } else {
      root.push(node);
    }
  }

  return root;
}

function findNode(tree: TreeNode[], path: string): TreeNode | null {
  for (const node of tree) {
    if (node.path === path) return node;
    if (node.isDir) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

// ── FileIcon ──

function FileIcon({ isDir, isOpen }: { isDir: boolean; isOpen?: boolean }) {
  if (isDir) {
    return (
      <span style={{ width: 16, textAlign: 'center', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
      </span>
    );
  }
  return (
    <span style={{ width: 16, textAlign: 'center', flexShrink: 0, color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <DiamondIcon size={8} />
    </span>
  );
}

// ── Context Menu ──

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode | null;
}

function ContextMenu({
  menu,
  onClose,
  onAction,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onAction: (action: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const items: { label: string; action: string }[] = [];
  if (!menu.node || menu.node.isDir) {
    items.push({ label: 'New File', action: 'newFile' });
    items.push({ label: 'New Folder', action: 'newFolder' });
  }
  if (menu.node) {
    items.push({ label: 'Rename', action: 'rename' });
    items.push({ label: 'Delete', action: 'delete' });
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: menu.x,
        top: menu.y,
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 1000,
        minWidth: 130,
        padding: '4px 0',
      }}
    >
      {items.map((item) => (
        <div
          key={item.action}
          onClick={() => onAction(item.action)}
          style={{
            padding: '5px 14px',
            fontSize: 'var(--font-size-sm)',
            cursor: 'pointer',
            color: item.action === 'delete' ? 'var(--color-danger)' : 'var(--color-text)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-tertiary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}

// ── Inline Input ──

function InlineInput({
  icon,
  initialValue,
  placeholder,
  onSubmit,
  onCancel,
  style: extraStyle,
}: {
  icon: ReactNode;
  initialValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  style?: React.CSSProperties;
}) {
  const [value, setValue] = useState(initialValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    if (initialValue) inputRef.current?.select();
  }, [initialValue]);

  const doSubmit = () => {
    if (submitted.current) return;
    submitted.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialValue) {
      onSubmit(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <div style={{ padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4, ...extraStyle }}>
      <span style={{ width: 16, textAlign: 'center', flexShrink: 0, color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') doSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={doSubmit}
        placeholder={placeholder}
        style={{
          flex: 1,
          fontSize: 'var(--font-size-sm)',
          padding: '2px 4px',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          outline: 'none',
          fontFamily: 'var(--font-mono)',
          minWidth: 0,
        }}
      />
    </div>
  );
}

// ── FileTree (main component) ──

interface FileTreeProps {
  sessionId: string;
  files: SessionFile[];
  activeFileId: string | null;
  onSelectFile: (fileId: string) => void;
  onFilesChanged: () => void;
  sessionLanguage: string;
}

export default function FileTree({ sessionId, files, activeFileId, onSelectFile, onFilesChanged, sessionLanguage }: FileTreeProps) {
  const [treePaths, setTreePaths] = useState<string[]>([]);
  const [creatingFile, setCreatingFile] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingInDir, setCreatingInDir] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeFile = files.find((f) => f.id === activeFileId);
  const activeFilePath = activeFile?.filename ?? null;

  // Fetch directory tree
  const refreshTree = useCallback(async () => {
    try {
      const paths = await fileService.listTree(sessionId);
      setTreePaths(paths);
      // The server auto-registers files present on disk but missing from the DB.
      // If we see a file path here that isn't in our current `files` prop, the
      // server just inserted it — refresh the parent so we pick up its ID.
      const known = new Set(files.map((f) => f.filename));
      const hasUnknownFile = paths.some((p) => !p.endsWith('/') && !known.has(p));
      if (hasUnknownFile) onFilesChanged();
    } catch {
      // Fallback: derive from files
      setTreePaths(files.map((f) => f.filename));
    }
  }, [sessionId, files, onFilesChanged]);

  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  const tree = buildTree(treePaths, files);

  const handleClickFile = useCallback((node: TreeNode) => {
    if (node.file) {
      onSelectFile(node.file.id);
    }
  }, [onSelectFile]);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, node: null });
    }
  }, []);

  const handleDelete = useCallback(async (node: TreeNode) => {
    const message = node.isDir
      ? `Delete folder "${node.name}" and all its contents?`
      : `Delete "${node.name}"?`;
    if (!window.confirm(message)) return;
    try {
      if (node.isDir) {
        await fileService.removeFolder(sessionId, node.path);
      } else if (node.file) {
        await fileService.remove(sessionId, node.file.id);
      }
      onFilesChanged();
      await refreshTree();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  }, [sessionId, onFilesChanged, refreshTree]);

  const handleRenameSubmit = useCallback(async (oldPath: string, newName: string) => {
    const parentDir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;
    try {
      // Check if it's a directory or file
      const node = findNode(tree, oldPath);
      if (node?.isDir) {
        await fileService.renameFolder(sessionId, oldPath, newPath);
      } else if (node?.file) {
        await fileService.rename(sessionId, node.file.id, newPath);
      }
      onFilesChanged();
      await refreshTree();
    } catch (err) {
      console.error('Failed to rename:', err);
    }
    setRenamingPath(null);
  }, [sessionId, tree, onFilesChanged, refreshTree]);

  // Infer language from extension
  const inferLanguage = useCallback((filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = { py: 'python', jl: 'julia', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp', js: 'javascript', ts: 'typescript' };
    return map[ext] || sessionLanguage;
  }, [sessionLanguage]);

  const handleNewFileSubmit = useCallback(async (name: string) => {
    const fullPath = creatingInDir ? `${creatingInDir}/${name}` : name;
    try {
      const created = await fileService.create(sessionId, {
        filename: fullPath,
        language: inferLanguage(name),
        content: '',
      });
      onFilesChanged();
      await refreshTree();
      onSelectFile(created.id);
    } catch (err) {
      console.error('Failed to create file:', err);
    }
    setCreatingFile(false);
    setCreatingInDir('');
  }, [sessionId, creatingInDir, inferLanguage, onFilesChanged, refreshTree, onSelectFile]);

  const handleNewFolderSubmit = useCallback(async (name: string) => {
    const fullPath = creatingInDir ? `${creatingInDir}/${name}` : name;
    try {
      await fileService.createFolder(sessionId, fullPath);
      await refreshTree();
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
    setCreatingFolder(false);
    setCreatingInDir('');
  }, [sessionId, creatingInDir, refreshTree]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;
    for (const file of Array.from(uploadedFiles)) {
      try {
        const created = await fileService.upload(sessionId, file);
        onFilesChanged();
        await refreshTree();
        onSelectFile(created.id);
      } catch (err) {
        console.error('Failed to upload file:', err);
      }
    }
    e.target.value = '';
  }, [sessionId, onFilesChanged, refreshTree, onSelectFile]);

  const handleContextAction = useCallback((action: string) => {
    const node = contextMenu?.node ?? null;
    setContextMenu(null);

    if (action === 'delete' && node) {
      handleDelete(node);
    } else if (action === 'rename' && node) {
      setRenamingPath(node.path);
    } else if (action === 'newFile') {
      if (node?.isDir) {
        setCreatingInDir(node.path);
      } else {
        setCreatingInDir('');
      }
      setCreatingFile(true);
    } else if (action === 'newFolder') {
      if (node?.isDir) {
        setCreatingInDir(node.path);
      } else {
        setCreatingInDir('');
      }
      setCreatingFolder(true);
    }
  }, [contextMenu, handleDelete]);

  return (
    <div className={styles.fileTree}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerLabel}>Files</span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />
        <button
          className={styles.headerButton}
          onClick={() => fileInputRef.current?.click()}
          title="Upload file"
        >
          <PlusIcon size={12} />
        </button>
      </div>

      {/* Tree content */}
      <div
        className={styles.treeContent}
        onContextMenu={handleBackgroundContextMenu}
      >
        {/* Inline create inputs */}
        {creatingFile && !creatingInDir && (
          <InlineInput
            icon={<DiamondIcon size={8} />}
            placeholder="filename"
            onSubmit={handleNewFileSubmit}
            onCancel={() => { setCreatingFile(false); setCreatingInDir(''); }}
          />
        )}
        {creatingFolder && !creatingInDir && (
          <InlineInput
            icon={<ChevronRightIcon size={10} />}
            placeholder="folder name"
            onSubmit={handleNewFolderSubmit}
            onCancel={() => { setCreatingFolder(false); setCreatingInDir(''); }}
          />
        )}

        {/* Tree items */}
        {tree.map((node) => (
          <TreeItemWithCreate
            key={node.path}
            node={node}
            depth={0}
            activeFilePath={activeFilePath}
            onContextMenu={handleContextMenu}
            renamingPath={renamingPath}
            onRenameSubmit={handleRenameSubmit}
            onRenameCancel={() => setRenamingPath(null)}
            onClickFile={handleClickFile}
            creatingFile={creatingFile}
            creatingFolder={creatingFolder}
            creatingInDir={creatingInDir}
            onNewFileSubmit={handleNewFileSubmit}
            onNewFolderSubmit={handleNewFolderSubmit}
            onCancelCreate={() => { setCreatingFile(false); setCreatingFolder(false); setCreatingInDir(''); }}
          />
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onAction={handleContextAction}
        />
      )}
    </div>
  );
}

// Wrapper that renders inline create inputs inside the correct folder
function TreeItemWithCreate({
  node,
  depth,
  activeFilePath,
  onContextMenu,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  onClickFile,
  creatingFile,
  creatingFolder,
  creatingInDir,
  onNewFileSubmit,
  onNewFolderSubmit,
  onCancelCreate,
}: {
  node: TreeNode;
  depth: number;
  activeFilePath: string | null;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  renamingPath: string | null;
  onRenameSubmit: (oldPath: string, newName: string) => void;
  onRenameCancel: () => void;
  onClickFile: (node: TreeNode) => void;
  creatingFile: boolean;
  creatingFolder: boolean;
  creatingInDir: string;
  onNewFileSubmit: (name: string) => void;
  onNewFolderSubmit: (name: string) => void;
  onCancelCreate: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = !node.isDir && node.path === activeFilePath;
  const isRenaming = renamingPath === node.path;
  const isCreateTarget = node.isDir && node.path === creatingInDir;

  const handleClick = useCallback(() => {
    if (node.isDir) {
      setExpanded((e) => !e);
    } else {
      onClickFile(node);
    }
  }, [node, onClickFile]);

  if (isRenaming) {
    return (
      <InlineInput
        icon={node.isDir ? <ChevronRightIcon size={10} /> : <DiamondIcon size={8} />}
        initialValue={node.name}
        onSubmit={(newName) => onRenameSubmit(node.path, newName)}
        onCancel={onRenameCancel}
        style={{ paddingLeft: 8 + depth * 14 }}
      />
    );
  }

  return (
    <>
      <div
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        onMouseEnter={(e) => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-tertiary)';
        }}
        onMouseLeave={(e) => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 8px',
          paddingLeft: 8 + depth * 14,
          fontSize: 'var(--font-size-sm)',
          fontFamily: 'var(--font-mono)',
          cursor: 'pointer',
          color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
          background: isActive ? 'var(--color-primary-light)' : 'transparent',
          fontWeight: isActive ? 500 : 400,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={node.path}
      >
        <FileIcon isDir={node.isDir} isOpen={expanded} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{node.name}</span>
      </div>
      {node.isDir && expanded && (
        <>
          {/* Inline create inputs inside this folder */}
          {isCreateTarget && creatingFile && (
            <InlineInput
              icon={<DiamondIcon size={8} />}
              placeholder="filename"
              onSubmit={onNewFileSubmit}
              onCancel={onCancelCreate}
              style={{ paddingLeft: 8 + (depth + 1) * 14 }}
            />
          )}
          {isCreateTarget && creatingFolder && (
            <InlineInput
              icon={<ChevronRightIcon size={10} />}
              placeholder="folder name"
              onSubmit={onNewFolderSubmit}
              onCancel={onCancelCreate}
              style={{ paddingLeft: 8 + (depth + 1) * 14 }}
            />
          )}
          {node.children.map((child) => (
            <TreeItemWithCreate
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onClickFile={onClickFile}
              creatingFile={creatingFile}
              creatingFolder={creatingFolder}
              creatingInDir={creatingInDir}
              onNewFileSubmit={onNewFileSubmit}
              onNewFolderSubmit={onNewFolderSubmit}
              onCancelCreate={onCancelCreate}
            />
          ))}
        </>
      )}
    </>
  );
}
