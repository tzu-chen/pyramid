import { SYMBOL_GROUPS } from '../../data/unicodeSymbols';
import styles from './SymbolPalette.module.css';

interface SymbolPaletteProps {
  onInsert: (symbol: string) => void;
}

function SymbolPalette({ onInsert }: SymbolPaletteProps) {
  return (
    <div className={styles.palette}>
      {SYMBOL_GROUPS.map((group, gi) => (
        <div key={gi} className={styles.group}>
          <span className={styles.groupLabel}>{group.label}</span>
          <div className={styles.groupSymbols}>
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
  );
}

export default SymbolPalette;
