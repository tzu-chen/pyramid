import { useState, useEffect, useRef } from 'react';
import { settingsService } from '../../services/claudeService';
import { claudeService } from '../../services/claudeService';
import { pythonEnvService } from '../../services/pythonEnvService';
import { useTheme } from '../../contexts/ThemeContext';
import { useEditorFontSize } from '../../contexts/EditorFontSizeContext';
import { useEditorVimMode } from '../../contexts/EditorVimModeContext';
import { usePowerSaver } from '../../contexts/PowerSaverContext';
import { useKeybindings } from '../../contexts/KeybindingsContext';
import { KEYBINDING_META, type KeybindingAction, type KeybindingsConfig } from '../../types/keybindings';
import { editorStorage } from '../../services/editorStorage';
import { COLOR_SCHEMES } from '../../colorSchemes';
import styles from './SettingsModal.module.css';

interface SettingsModalProps {
  onClose: () => void;
}

type Tab = 'general' | 'shortcuts';

function formatKey(key: string): string {
  if (!key) return '—';
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function findDuplicate(action: KeybindingAction, key: string, all: KeybindingsConfig): boolean {
  return (Object.keys(all) as KeybindingAction[]).some(
    other => other !== action && all[other] === key,
  );
}

function ShortcutRow({ action, label, scope }: { action: KeybindingAction; label: string; scope: string }) {
  const { keybindings, setKeybinding } = useKeybindings();
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      setKeybinding(action, e.key.toLowerCase());
      setRecording(false);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, action, setKeybinding]);

  return (
    <div className={styles.shortcutRow}>
      <div className={styles.shortcutInfo}>
        <span className={styles.shortcutLabel}>{label}</span>
        <span className={styles.shortcutScope}>{scope}</span>
      </div>
      <button
        type="button"
        className={`${styles.keyButton} ${recording ? styles.keyButtonRecording : ''}`}
        onClick={() => setRecording(r => !r)}
        title={recording ? 'Press a key (Esc to cancel)' : 'Click to rebind'}
      >
        {recording ? 'Press a key…' : formatKey(keybindings[action])}
      </button>
    </div>
  );
}

const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-7';

const PYTHON_VERSION_OPTIONS = ['', '3.14', '3.13', '3.12', '3.11', '3.10'];

const CLAUDE_MODEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'claude-opus-4-7', label: 'Opus 4.7 (default)' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

function SettingsModal({ onClose }: SettingsModalProps) {
  const { schemeId, setScheme, autoSwitch, setAutoSwitch } = useTheme();
  const { fontSize, increase: fontIncrease, decrease: fontDecrease, reset: fontReset } = useEditorFontSize();
  const { vimMode, toggle: toggleVimMode } = useEditorVimMode();
  const { enabled: powerSaver, toggle: togglePowerSaver } = usePowerSaver();
  const { keybindings, resetKeybindings } = useKeybindings();

  const [tab, setTab] = useState<Tab>('general');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [testError, setTestError] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_CLAUDE_MODEL);
  const [pyVersion, setPyVersion] = useState('');
  const [uvCacheDir, setUvCacheDir] = useState('');
  const [pruning, setPruning] = useState(false);
  const [pruneMsg, setPruneMsg] = useState('');

  const overlayMouseDownRef = useRef(false);

  useEffect(() => {
    settingsService.get('claude_api_key').then(setting => {
      if (setting?.value) {
        setHasKey(true);
      }
    }).catch(() => {});
    settingsService.get('claude_model').then(setting => {
      if (setting?.value) {
        setModel(setting.value);
      }
    }).catch(() => {});
    settingsService.get('python_default_version').then(s => { if (s?.value) setPyVersion(s.value); }).catch(() => {});
    settingsService.get('uv_cache_dir').then(s => { if (s?.value) setUvCacheDir(s.value); }).catch(() => {});
  }, []);

  const handlePyVersionChange = async (next: string) => {
    setPyVersion(next);
    try { await settingsService.set('python_default_version', next); } catch { /* retry by reselecting */ }
  };

  const handleCacheDirSave = async () => {
    try { await settingsService.set('uv_cache_dir', uvCacheDir.trim()); } catch { /* */ }
  };

  const handlePrune = async () => {
    setPruning(true);
    setPruneMsg('');
    try {
      await pythonEnvService.pruneCache();
      setPruneMsg('uv cache pruned.');
    } catch (err) {
      setPruneMsg((err as Error).message);
    } finally {
      setPruning(false);
    }
  };

  const handleModelChange = async (next: string) => {
    setModel(next);
    try {
      await settingsService.set('claude_model', next);
    } catch {
      // Silent fail; user can retry by reselecting.
    }
  };

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

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'general' ? styles.tabActive : ''}`}
            onClick={() => setTab('general')}
          >
            General
          </button>
          <button
            className={`${styles.tab} ${tab === 'shortcuts' ? styles.tabActive : ''}`}
            onClick={() => setTab('shortcuts')}
          >
            Shortcuts
          </button>
        </div>

        {tab === 'general' && (
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
                </button>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Performance</h3>
            <div className={styles.row}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Power saver</span>
                <span className={styles.rowDesc}>
                  Suspend language servers, kernels, and terminal shells within ~5s of switching tabs
                  (default ~60s). Recommended on iPad / battery.
                </span>
              </div>
              <button
                className={`${styles.toggle} ${powerSaver ? styles.toggleOn : ''}`}
                onClick={togglePowerSaver}
                role="switch"
                aria-checked={powerSaver}
                aria-label="Power saver"
              >
                <span className={styles.toggleThumb} />
              </button>
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Claude</h3>

            <div className={styles.row}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Model</span>
                <span className={styles.rowDesc}>Used for Claude chat in every session</span>
              </div>
              <select
                className={styles.modelSelect}
                value={CLAUDE_MODEL_OPTIONS.some(opt => opt.id === model) ? model : ''}
                onChange={e => handleModelChange(e.target.value)}
              >
                {!CLAUDE_MODEL_OPTIONS.some(opt => opt.id === model) && (
                  <option value="" disabled>{model}</option>
                )}
                {CLAUDE_MODEL_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>

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

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Python</h3>
            <div className={styles.row}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Default version</span>
                <span className={styles.rowDesc}>Interpreter for new python / notebook sessions when none is chosen</span>
              </div>
              <select
                className={styles.modelSelect}
                value={pyVersion}
                onChange={e => handlePyVersionChange(e.target.value)}
              >
                {PYTHON_VERSION_OPTIONS.map(v => (
                  <option key={v || 'default'} value={v}>{v ? v : 'Default (3.12)'}</option>
                ))}
              </select>
            </div>
            <div className={styles.row}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>uv cache directory</span>
                <span className={styles.rowDesc}>Optional shared download cache (UV_CACHE_DIR). Blank uses uv's default.</span>
              </div>
            </div>
            <div className={styles.keyRow}>
              <input
                className={styles.keyInput}
                type="text"
                value={uvCacheDir}
                onChange={e => setUvCacheDir(e.target.value)}
                onBlur={handleCacheDirSave}
                placeholder="(uv default ~/.cache/uv)"
              />
              <button className={styles.saveBtn} onClick={handleCacheDirSave}>Save</button>
            </div>
            <button className={styles.testBtn} onClick={handlePrune} disabled={pruning}>
              {pruning ? 'Pruning…' : 'Prune uv cache'}
            </button>
            {pruneMsg && <div className={styles.testSuccess}>{pruneMsg}</div>}
          </section>
        </div>
        )}

        {tab === 'shortcuts' && (
        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Keyboard Shortcuts</h3>
            <p className={styles.shortcutHint}>
              Click a key to rebind. Single-character keys only; Esc cancels recording.
              Shortcuts only fire when no input or editor is focused.
            </p>
            <div className={styles.shortcutList}>
              {KEYBINDING_META.map(m => (
                <ShortcutRow key={m.action} action={m.action} label={m.label} scope={m.scope} />
              ))}
            </div>
            {KEYBINDING_META.some(m => findDuplicate(m.action, keybindings[m.action], keybindings)) && (
              <p className={styles.shortcutWarning}>
                Duplicate key assigned — only one action will fire.
              </p>
            )}
            <button className={styles.testBtn} onClick={resetKeybindings}>
              Reset to defaults
            </button>
          </section>
        </div>
        )}
      </div>
    </div>
  );
}

export default SettingsModal;
