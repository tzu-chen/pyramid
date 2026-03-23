import { useState, useRef } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { COLOR_SCHEMES } from '../../colorSchemes';
import { CloseIcon, PaletteIcon } from '../Icons/Icons';
import styles from './ThemeMenu.module.css';

export function ThemeMenu() {
  const { schemeId, setScheme, autoSwitch, setAutoSwitch } = useTheme();
  const [open, setOpen] = useState(false);
  const overlayMouseDownRef = useRef(false);

  return (
    <>
      <button
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-label="Change theme"
        title="Change theme"
      >
        <PaletteIcon size={18} />
      </button>

      {open && (
        <div
          className={styles.overlay}
          onMouseDown={e => {
            overlayMouseDownRef.current = e.target === e.currentTarget;
          }}
          onClick={e => {
            if (overlayMouseDownRef.current && e.target === e.currentTarget) {
              setOpen(false);
            }
            overlayMouseDownRef.current = false;
          }}
        >
          <div className={styles.panel}>
            <div className={styles.header}>
              <h3 className={styles.title}>Theme</h3>
              <button
                className={styles.close}
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <div className={styles.body}>
              <div className={styles.autoSwitch}>
                <div className={styles.autoSwitchInfo}>
                  <span className={styles.autoSwitchLabel}>Auto switch</span>
                  <span className={styles.autoSwitchDesc}>
                    Light theme by day, dark by night
                  </span>
                </div>
                <button
                  className={`${styles.toggle} ${autoSwitch.enabled ? styles.toggleOn : ''}`}
                  onClick={() => setAutoSwitch({ ...autoSwitch, enabled: !autoSwitch.enabled })}
                  role="switch"
                  aria-checked={autoSwitch.enabled}
                  aria-label="Auto theme switching"
                >
                  <span className={styles.toggleThumb} />
                </button>
              </div>
              <div className={styles.grid}>
                {COLOR_SCHEMES.map(scheme => (
                  <button
                    key={scheme.id}
                    className={`${styles.card} ${scheme.id === schemeId ? styles.cardActive : ''}`}
                    onClick={() => {
                      setScheme(scheme.id);
                      setOpen(false);
                    }}
                  >
                    <div className={styles.preview}>
                      <div
                        className={styles.swatchBg}
                        style={{ background: scheme.colors['color-bg'] }}
                      >
                        <div
                          className={styles.swatchBar}
                          style={{
                            background: scheme.colors['color-surface'],
                            borderBottom: `2px solid ${scheme.colors['color-border']}`,
                          }}
                        />
                        <div className={styles.swatchBody}>
                          <div
                            className={styles.swatchCard}
                            style={{
                              background: scheme.colors['color-surface'],
                              border: `1px solid ${scheme.colors['color-border']}`,
                            }}
                          >
                            <div
                              className={styles.swatchText}
                              style={{ background: scheme.colors['color-text'] }}
                            />
                            <div
                              className={`${styles.swatchText} ${styles.swatchTextShort}`}
                              style={{ background: scheme.colors['color-text-secondary'] }}
                            />
                          </div>
                          <div
                            className={styles.swatchAccent}
                            style={{ background: scheme.colors['color-primary'] }}
                          />
                        </div>
                      </div>
                    </div>
                    <span className={styles.cardName}>{scheme.name}</span>
                    <span className={styles.cardType}>{scheme.type}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
