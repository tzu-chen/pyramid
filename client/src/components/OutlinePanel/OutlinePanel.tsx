import { useState, useMemo } from 'react';
import type { CppDocumentSymbol } from '../../hooks/useCppLsp';
import styles from './OutlinePanel.module.css';

interface OutlinePanelProps {
  symbols: CppDocumentSymbol[];
  loading: boolean;
  initialized: boolean;
  onSelect: (line: number, character: number) => void;
}

// LSP SymbolKind enum (1-26). Mapped to short labels and CSS class suffixes
// for color-coding the icon. Only the kinds clangd actually emits matter; the
// rest fall back to "?".
const KIND_INFO: Record<number, { label: string; cls: string }> = {
  1: { label: 'F', cls: 'kindFile' },
  2: { label: 'M', cls: 'kindNamespace' },
  3: { label: 'P', cls: 'kindNamespace' },
  4: { label: 'N', cls: 'kindNamespace' },
  5: { label: 'C', cls: 'kindClass' },
  6: { label: 'm', cls: 'kindMethod' },
  7: { label: 'p', cls: 'kindProperty' },
  8: { label: 'f', cls: 'kindField' },
  9: { label: 'c', cls: 'kindMethod' },
  10: { label: 'E', cls: 'kindEnum' },
  11: { label: 'I', cls: 'kindClass' },
  12: { label: 'ƒ', cls: 'kindFunction' },
  13: { label: 'v', cls: 'kindVariable' },
  14: { label: 'k', cls: 'kindVariable' },
  15: { label: '"', cls: 'kindVariable' },
  16: { label: '#', cls: 'kindVariable' },
  17: { label: 'b', cls: 'kindVariable' },
  18: { label: '[]', cls: 'kindVariable' },
  19: { label: '{}', cls: 'kindVariable' },
  20: { label: 'k', cls: 'kindVariable' },
  21: { label: '∅', cls: 'kindVariable' },
  22: { label: 'e', cls: 'kindEnum' },
  23: { label: 's', cls: 'kindClass' },
  24: { label: '⟨⟩', cls: 'kindClass' },
  25: { label: 'T', cls: 'kindClass' },
  26: { label: 'op', cls: 'kindMethod' },
};

interface FlatNode {
  symbol: CppDocumentSymbol;
  depth: number;
  path: string;
  hasChildren: boolean;
}

function flatten(
  symbols: CppDocumentSymbol[],
  depth: number,
  parentPath: string,
  collapsed: Set<string>,
  out: FlatNode[],
): void {
  symbols.forEach((sym, i) => {
    const path = `${parentPath}/${i}:${sym.name}`;
    const hasChildren = !!sym.children && sym.children.length > 0;
    out.push({ symbol: sym, depth, path, hasChildren });
    if (hasChildren && !collapsed.has(path)) {
      flatten(sym.children!, depth + 1, path, collapsed, out);
    }
  });
}

function OutlinePanel({ symbols, loading, initialized, onSelect }: OutlinePanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const out: FlatNode[] = [];
    flatten(symbols, 0, '', collapsed, out);
    return out;
  }, [symbols, collapsed]);

  const toggle = (path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (!initialized) {
    return <div className={styles.placeholder}>Connecting to clangd...</div>;
  }

  if (symbols.length === 0) {
    return (
      <div className={styles.placeholder}>
        {loading ? 'Loading symbols...' : 'No symbols in this file'}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {rows.map(({ symbol, depth, path, hasChildren }) => {
        const kind = KIND_INFO[symbol.kind] ?? { label: '?', cls: 'kindVariable' };
        const isCollapsed = collapsed.has(path);
        return (
          <div
            key={path}
            className={styles.row}
            style={{ paddingLeft: `calc(var(--space-2) + ${depth * 14}px)` }}
            onClick={() => onSelect(symbol.selectionRange.start.line, symbol.selectionRange.start.character)}
            title={symbol.detail || symbol.name}
          >
            <span
              className={styles.chevron}
              onClick={(e) => {
                if (!hasChildren) return;
                e.stopPropagation();
                toggle(path);
              }}
            >
              {hasChildren ? (isCollapsed ? '▸' : '▾') : ''}
            </span>
            <span className={`${styles.kind} ${styles[kind.cls]}`}>{kind.label}</span>
            <span className={styles.name}>{symbol.name}</span>
            {symbol.detail && (
              <span className={styles.detail}>{symbol.detail}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default OutlinePanel;
