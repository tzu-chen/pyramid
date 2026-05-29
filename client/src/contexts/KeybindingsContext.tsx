import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { keybindingsStorage } from '../services/keybindingsStorage';
import {
  DEFAULT_KEYBINDINGS,
  type KeybindingAction,
  type KeybindingsConfig,
} from '../types/keybindings';

interface KeybindingsContextValue {
  keybindings: KeybindingsConfig;
  setKeybinding: (action: KeybindingAction, key: string) => void;
  resetKeybindings: () => void;
}

const KeybindingsContext = createContext<KeybindingsContextValue | null>(null);

export function KeybindingsProvider({ children }: { children: ReactNode }) {
  const [keybindings, setKeybindings] = useState<KeybindingsConfig>(() => keybindingsStorage.get());

  const setKeybinding = useCallback((action: KeybindingAction, key: string) => {
    setKeybindings(prev => {
      const next = { ...prev, [action]: key.toLowerCase() };
      keybindingsStorage.save(next);
      return next;
    });
  }, []);

  const resetKeybindings = useCallback(() => {
    const next = { ...DEFAULT_KEYBINDINGS };
    setKeybindings(next);
    keybindingsStorage.save(next);
  }, []);

  return (
    <KeybindingsContext.Provider value={{ keybindings, setKeybinding, resetKeybindings }}>
      {children}
    </KeybindingsContext.Provider>
  );
}

export function useKeybindings(): KeybindingsContextValue {
  const ctx = useContext(KeybindingsContext);
  if (!ctx) throw new Error('useKeybindings must be used within a KeybindingsProvider');
  return ctx;
}
