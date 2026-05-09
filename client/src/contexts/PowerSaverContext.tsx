import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { editorStorage } from '../services/editorStorage';

const HIDDEN_DELAY_NORMAL_MS = 60_000;
const HIDDEN_DELAY_POWER_MS = 5_000;

interface PowerSaverContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
  /**
   * How long the page must be hidden before LSP / kernel / terminal WebSockets
   * are torn down. Aggressive in power-saver mode, generous otherwise.
   */
  hiddenDelayMs: number;
}

const PowerSaverContext = createContext<PowerSaverContextValue | null>(null);

export function PowerSaverProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(() => editorStorage.getPowerSaver());

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    editorStorage.savePowerSaver(next);
  }, []);

  const toggle = useCallback(() => {
    setEnabledState(prev => {
      const next = !prev;
      editorStorage.savePowerSaver(next);
      return next;
    });
  }, []);

  const value = useMemo<PowerSaverContextValue>(() => ({
    enabled,
    setEnabled,
    toggle,
    hiddenDelayMs: enabled ? HIDDEN_DELAY_POWER_MS : HIDDEN_DELAY_NORMAL_MS,
  }), [enabled, setEnabled, toggle]);

  return (
    <PowerSaverContext.Provider value={value}>
      {children}
    </PowerSaverContext.Provider>
  );
}

export function usePowerSaver(): PowerSaverContextValue {
  const ctx = useContext(PowerSaverContext);
  if (!ctx) throw new Error('usePowerSaver must be used within a PowerSaverProvider');
  return ctx;
}
