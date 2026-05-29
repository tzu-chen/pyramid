const FONT_SIZE_KEY = 'pyramid_editor_font_size';
const VIM_MODE_KEY = 'pyramid_editor_vim_mode';
const POWER_SAVER_KEY = 'pyramid_power_saver';
const NOTEBOOK_LINE_NUMBERS_KEY = 'pyramid_notebook_line_numbers';
const NOTEBOOK_CELL_NUMBERS_KEY = 'pyramid_notebook_cell_numbers';
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

  getPowerSaver(): boolean {
    try {
      return localStorage.getItem(POWER_SAVER_KEY) === '1';
    } catch { /* localStorage unavailable */ }
    return false;
  },

  savePowerSaver(enabled: boolean): void {
    try {
      localStorage.setItem(POWER_SAVER_KEY, enabled ? '1' : '0');
    } catch { /* localStorage unavailable */ }
  },

  // Notebook line numbers default ON; absent key is treated as enabled.
  getNotebookLineNumbers(): boolean {
    try {
      return localStorage.getItem(NOTEBOOK_LINE_NUMBERS_KEY) !== '0';
    } catch { /* localStorage unavailable */ }
    return true;
  },

  saveNotebookLineNumbers(enabled: boolean): void {
    try {
      localStorage.setItem(NOTEBOOK_LINE_NUMBERS_KEY, enabled ? '1' : '0');
    } catch { /* localStorage unavailable */ }
  },

  // Notebook cell numbers default ON; absent key is treated as enabled.
  getNotebookCellNumbers(): boolean {
    try {
      return localStorage.getItem(NOTEBOOK_CELL_NUMBERS_KEY) !== '0';
    } catch { /* localStorage unavailable */ }
    return true;
  },

  saveNotebookCellNumbers(enabled: boolean): void {
    try {
      localStorage.setItem(NOTEBOOK_CELL_NUMBERS_KEY, enabled ? '1' : '0');
    } catch { /* localStorage unavailable */ }
  },

  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  DEFAULT_FONT_SIZE,
};
