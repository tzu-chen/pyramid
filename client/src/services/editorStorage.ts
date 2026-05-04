const FONT_SIZE_KEY = 'pyramid_editor_font_size';
const VIM_MODE_KEY = 'pyramid_editor_vim_mode';
const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;

function clamp(value: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, value));
}

export const editorStorage = {
  getFontSize(): number {
    try {
      const stored = localStorage.getItem(FONT_SIZE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) return clamp(parsed);
      }
    } catch { /* localStorage unavailable */ }
    return DEFAULT_FONT_SIZE;
  },

  saveFontSize(size: number): void {
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(clamp(size)));
    } catch { /* localStorage unavailable */ }
  },

  getVimMode(): boolean {
    try {
      return localStorage.getItem(VIM_MODE_KEY) === '1';
    } catch { /* localStorage unavailable */ }
    return false;
  },

  saveVimMode(enabled: boolean): void {
    try {
      localStorage.setItem(VIM_MODE_KEY, enabled ? '1' : '0');
    } catch { /* localStorage unavailable */ }
  },

  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  DEFAULT_FONT_SIZE,
};
