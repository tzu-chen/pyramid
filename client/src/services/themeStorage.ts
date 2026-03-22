const THEME_KEY = 'pyramid_theme';

export const themeStorage = {
  get(): 'light' | 'dark' {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'dark' ? 'dark' : 'light';
  },

  set(theme: 'light' | 'dark') {
    localStorage.setItem(THEME_KEY, theme);
  },
};
