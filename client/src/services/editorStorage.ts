const FONT_SIZE_KEY = 'pyramid_editor_font_size';
const VIM_MODE_KEY = 'pyramid_editor_vim_mode';
const POWER_SAVER_KEY = 'pyramid_power_saver';
const NOTEBOOK_LINE_NUMBERS_KEY = 'pyramid_notebook_line_numbers';
const NOTEBOOK_CELL_NUMBERS_KEY = 'pyramid_notebook_cell_numbers';
const NOTEBOOK_CELL_HEADERS_KEY = 'pyramid_notebook_cell_headers';
const OPEN_FILES_KEY_PREFIX = 'pyramid_open_files_';
const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;

function clamp(value: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, value));
}

// Per-session record of which file tabs were open and which was focused, so a
// session reopens to its last-opened files (IDE-style). An empty `openFileIds`
// is a meaningful state — it means the user closed every tab and should see the
// blank welcome screen on return.
export interface OpenFilesState {
  openFileIds: string[];
  activeFileId: string | null;
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

  // Notebook cell headers (the per-cell strip with type/timing/actions) default
  // ON; absent key is treated as enabled.
  getNotebookCellHeaders(): boolean {
    try {
      return localStorage.getItem(NOTEBOOK_CELL_HEADERS_KEY) !== '0';
    } catch { /* localStorage unavailable */ }
    return true;
  },

  saveNotebookCellHeaders(enabled: boolean): void {
    try {
      localStorage.setItem(NOTEBOOK_CELL_HEADERS_KEY, enabled ? '1' : '0');
    } catch { /* localStorage unavailable */ }
  },

  // Returns the persisted open-tab state for a session, or null if the session
  // has never been opened before (first visit → caller picks a default file).
  getOpenFiles(sessionId: string): OpenFilesState | null {
    try {
      const raw = localStorage.getItem(OPEN_FILES_KEY_PREFIX + sessionId);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.openFileIds)) {
        return {
          openFileIds: parsed.openFileIds.filter((x: unknown) => typeof x === 'string'),
          activeFileId: typeof parsed.activeFileId === 'string' ? parsed.activeFileId : null,
        };
      }
    } catch { /* localStorage unavailable or malformed */ }
    return null;
  },

  saveOpenFiles(sessionId: string, state: OpenFilesState): void {
    try {
      localStorage.setItem(OPEN_FILES_KEY_PREFIX + sessionId, JSON.stringify(state));
    } catch { /* localStorage unavailable */ }
  },

  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  DEFAULT_FONT_SIZE,
};
