import { DEFAULT_KEYBINDINGS, type KeybindingsConfig } from '../types/keybindings';

const STORAGE_KEY = 'pyramid_keybindings';

export const keybindingsStorage = {
  get(): KeybindingsConfig {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_KEYBINDINGS };
    try {
      const parsed = JSON.parse(raw) as Partial<KeybindingsConfig>;
      return { ...DEFAULT_KEYBINDINGS, ...parsed };
    } catch {
      return { ...DEFAULT_KEYBINDINGS };
    }
  },

  save(config: KeybindingsConfig): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  },
};
