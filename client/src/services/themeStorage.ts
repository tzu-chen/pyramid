import {
  COLOR_SCHEMES,
  DEFAULT_SCHEME_ID,
  DEFAULT_LIGHT_SCHEME_ID,
  DEFAULT_DARK_SCHEME_ID,
} from '../colorSchemes';

const STORAGE_KEY = 'pyramid_theme';
const AUTO_STORAGE_KEY = 'pyramid_theme_auto';

/** Map old stored values to the current light/dark scheme IDs. */
const LEGACY_MAP: Record<string, string> = {
  'default-light': DEFAULT_LIGHT_SCHEME_ID,
  'solarized-light': DEFAULT_LIGHT_SCHEME_ID,
  'gruvbox-light': DEFAULT_LIGHT_SCHEME_ID,
  'catppuccin-latte': DEFAULT_LIGHT_SCHEME_ID,
  'default-dark': DEFAULT_DARK_SCHEME_ID,
  'solarized-dark': DEFAULT_DARK_SCHEME_ID,
  nord: DEFAULT_DARK_SCHEME_ID,
  dracula: DEFAULT_DARK_SCHEME_ID,
};

function coerceSchemeId(id: string | undefined | null, fallback: string): string {
  if (!id) return fallback;
  const mapped = LEGACY_MAP[id] ?? id;
  return COLOR_SCHEMES.some(s => s.id === mapped) ? mapped : fallback;
}

export interface AutoSwitchSettings {
  enabled: boolean;
  lightSchemeId: string;
  darkSchemeId: string;
  dayStartHour: number;
  nightStartHour: number;
}

const DEFAULT_AUTO_SETTINGS: AutoSwitchSettings = {
  enabled: false,
  lightSchemeId: DEFAULT_LIGHT_SCHEME_ID,
  darkSchemeId: DEFAULT_DARK_SCHEME_ID,
  dayStartHour: 7,
  nightStartHour: 19,
};

export const themeStorage = {
  get(): string {
    return coerceSchemeId(localStorage.getItem(STORAGE_KEY), DEFAULT_SCHEME_ID);
  },

  save(schemeId: string): void {
    localStorage.setItem(STORAGE_KEY, schemeId);
  },

  getAuto(): AutoSwitchSettings {
    const raw = localStorage.getItem(AUTO_STORAGE_KEY);
    if (!raw) return DEFAULT_AUTO_SETTINGS;
    try {
      const parsed = JSON.parse(raw);
      const merged = { ...DEFAULT_AUTO_SETTINGS, ...parsed };
      return {
        ...merged,
        lightSchemeId: coerceSchemeId(merged.lightSchemeId, DEFAULT_LIGHT_SCHEME_ID),
        darkSchemeId: coerceSchemeId(merged.darkSchemeId, DEFAULT_DARK_SCHEME_ID),
      };
    } catch {
      return DEFAULT_AUTO_SETTINGS;
    }
  },

  saveAuto(settings: AutoSwitchSettings): void {
    localStorage.setItem(AUTO_STORAGE_KEY, JSON.stringify(settings));
  },
};
