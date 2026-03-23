import { COLOR_SCHEMES, DEFAULT_SCHEME_ID } from '../colorSchemes';

const STORAGE_KEY = 'pyramid_theme';
const AUTO_STORAGE_KEY = 'pyramid_theme_auto';

/** Map old stored values to new scheme IDs for backward compatibility. */
const LEGACY_MAP: Record<string, string> = {
  light: 'default-light',
  dark: 'default-dark',
};

export interface AutoSwitchSettings {
  enabled: boolean;
  lightSchemeId: string;
  darkSchemeId: string;
  dayStartHour: number;
  nightStartHour: number;
}

const DEFAULT_AUTO_SETTINGS: AutoSwitchSettings = {
  enabled: false,
  lightSchemeId: 'default-light',
  darkSchemeId: 'default-dark',
  dayStartHour: 7,
  nightStartHour: 19,
};

export const themeStorage = {
  get(): string {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SCHEME_ID;
    const mapped = LEGACY_MAP[raw] ?? raw;
    if (COLOR_SCHEMES.some(s => s.id === mapped)) return mapped;
    return DEFAULT_SCHEME_ID;
  },

  save(schemeId: string): void {
    localStorage.setItem(STORAGE_KEY, schemeId);
  },

  getAuto(): AutoSwitchSettings {
    const raw = localStorage.getItem(AUTO_STORAGE_KEY);
    if (!raw) return DEFAULT_AUTO_SETTINGS;
    try {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_AUTO_SETTINGS, ...parsed };
    } catch {
      return DEFAULT_AUTO_SETTINGS;
    }
  },

  saveAuto(settings: AutoSwitchSettings): void {
    localStorage.setItem(AUTO_STORAGE_KEY, JSON.stringify(settings));
  },
};
