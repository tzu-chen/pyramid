import { useState, useEffect } from 'react';
import { settingsService } from '../../services/claudeService';
import { claudeService } from '../../services/claudeService';
import styles from './SettingsModal.module.css';

interface SettingsModalProps {
  onClose: () => void;
}

function SettingsModal({ onClose }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [testError, setTestError] = useState('');

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
      // Make a minimal API call to verify the key works
      // We use a dummy session ID — the route will check the key before the session
      await claudeService.ask('test', 'Say "ok"', [], 'general');
      setTestResult('success');
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Session not found')) {
        // Key is valid — the request failed because the session doesn't exist, not the key
        setTestResult('success');
      } else {
        setTestResult('error');
        setTestError(msg);
      }
    } finally {
      setTesting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.body}>
          <div className={styles.section}>
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
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
