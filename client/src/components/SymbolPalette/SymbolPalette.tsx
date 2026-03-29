import { useState, useRef, useEffect } from 'react';
import { SYMBOL_GROUPS } from '../../data/unicodeSymbols';
import styles from './SymbolPalette.module.css';

interface SymbolPaletteProps {
  onInsert: (symbol: string) => void;
}

function SymbolPalette({ onInsert }: SymbolPaletteProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className={styles.container}>
      <button
        ref={btnRef}
        className={styles.triggerBtn}
        onClick={() => setOpen(prev => !prev)}
      >
        <span className={styles.triggerIcon}>{'\u03A3'}</span>
        Symbols
        <span className={styles.chevron}>{open ? '\u25B4' : '\u25BE'}</span>
      </button>
      {open && (
        <div ref={popoverRef} className={styles.popover}>
          {SYMBOL_GROUPS.map((group, gi) => (
            <div key={gi} className={styles.group}>
              <span className={styles.groupLabel}>{group.label}</span>
              <div className={styles.symbolGrid}>
                {group.symbols.map((s, si) => (
                  <button
                    key={si}
                    className={styles.symbolBtn}
                    title={s.key}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onInsert(s.char);
                    }}
                  >
                    {s.char}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SymbolPalette;
