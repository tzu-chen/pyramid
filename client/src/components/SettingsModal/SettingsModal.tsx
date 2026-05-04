import { useState, useEffect, useRef } from 'react';
import { settingsService } from '../../services/claudeService';
import { claudeService } from '../../services/claudeService';
import { useTheme } from '../../contexts/ThemeContext';
import { useEditorFontSize } from '../../contexts/EditorFontSizeContext';
import { useEditorVimMode } from '../../contexts/EditorVimModeContext';
import { editorStorage } from '../../services/editorStorage';
import { COLOR_SCHEMES } from '../../colorSchemes';
import styles from './SettingsModal.module.css';

interface SettingsModalProps {
  onClose: () => void;
}

function SettingsModal({ onClose }: SettingsModalProps) {
  const { schemeId, setScheme, autoSwitch, setAutoSwitch } = useTheme();
  const { fontSize, increase: fontIncrease, decrease: fontDecrease, reset: fontReset } = useEditorFontSize();
  const { vimMode, toggle: toggleVimMode } = useEditorVimMode();

  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [testError, setTestError] = useState('');

  const overlayMouseDownRef = useRef(false);

  useEffect(() => {
    settingsService.get('claude_api_key').then(setting => {
      if (setting?.value) {
        setHasKey(true);
      }
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await settingsService.set('claude_api_key', apiKey.trim());
      setHasKey(true);
      setApiKey('');
    } catch (err) {
      setTestError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError('');
    try {
      await claudeService.ask('test', 'Say "ok"', [], 'general');
      setTestResult('success');
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Session not found')) {
        setTestResult('success');
      } else {
        setTestResult('error');
        setTestError(msg);
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      onMouseDown={e => {
        overlayMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={e => {
        if (overlayMouseDownRef.current && e.target === e.currentTarget) {
          onClose();
        }
        overlayMouseDownRef.current = false;
      }}
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Appearance</h3>
            <div className={styles.row}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Auto switch</span>
                <span className={styles.rowDesc}>Light theme by day, dark by night</span>
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
            <div className={styles.row}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Editor font size</span>
              </div>
              <div className={styles.fontSizeControls}>
                <button
                  className={styles.fontSizeBtn}
                  onClick={fontDecrease}
                  disabled={fontSize <= editorStorage.MIN_FONT_SIZE}
                >
                  A−
                </button>
                <span className={styles.fontSizeValue}>{fontSize}px</span>
                <button
                  className={styles.fontSizeBtn}
                  onClick={fontIncrease}
                  disabled={fontSize >= editorStorage.MAX_FONT_SIZE}
                >
                  A+
                </button>
                {fontSize !== editorStorage.DEFAULT_FONT_SIZE && (
                  <button className={styles.fontSizeReset} onClick={fontReset}>
                    Reset
                  </button>
                )}
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Vim mode</span>
                <span className={styles.rowDesc}>Vim keybindings in all code editors</span>
              </div>
              <button
                className={`${styles.toggle} ${vimMode ? styles.toggleOn : ''}`}
                onClick={toggleVimMode}
                role="switch"
                aria-checked={vimMode}
                aria-label="Vim mode"
              >
                <span className={styles.toggleThumb} />
              </button>
            </div>
            <div className={styles.grid}>
              {COLOR_SCHEMES.map(scheme => (
                <button
                  key={scheme.id}
                  className={`${styles.card} ${scheme.id === schemeId ? styles.cardActive : ''}`}
                  onClick={() => setScheme(scheme.id)}
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
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Claude API Key</h3>
            <div className={styles.keyStatus}>
              Status: {hasKey ? (
                <span className={styles.keySet}>Configured</span>
              ) : (
                <span className={styles.keyNotSet}>Not set</span>
              )}
            </div>

            <div className={styles.keyRow}>
              <input
                className={styles.keyInput}
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={hasKey ? 'Enter new key to replace...' : 'sk-ant-...'}
              />
              <button className={styles.saveBtn} onClick={handleSave} disabled={saving || !apiKey.trim()}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>

            {hasKey && (
              <button className={styles.testBtn} onClick={handleTest} disabled={testing}>
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
            )}

            {testResult === 'success' && (
              <div className={styles.testSuccess}>API key is valid.</div>
            )}
            {testResult === 'error' && (
              <div className={styles.testError}>{testError}</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
