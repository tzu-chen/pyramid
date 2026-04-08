export interface ColorScheme {
  id: string;
  name: string;
  type: 'light' | 'dark';
  colors: Record<string, string>;
}

const defaultLight: ColorScheme = {
  id: 'default-light',
  name: 'Default Light',
  type: 'light',
  colors: {
    'color-bg': '#ffffff',
    'color-bg-secondary': '#f8f9fa',
    'color-bg-tertiary': '#f0f1f3',
    'color-surface': '#ffffff',
    'color-border': '#dee2e6',
    'color-border-light': '#e9ecef',
    'color-text': '#212529',
    'color-text-secondary': '#6c757d',
    'color-text-tertiary': '#adb5bd',
    'color-primary': '#4263eb',
    'color-primary-hover': '#3b5bdb',
    'color-primary-light': '#edf2ff',
    'color-primary-text': '#ffffff',
    'color-danger': '#c92a2a',
    'color-danger-hover': '#b02525',
    'color-danger-light': '#fff5f5',
    'color-success': '#2b8a3e',
    'color-success-light': '#ebfbee',
    'color-warning': '#e67700',
    'color-warning-light': '#fff9db',
    'color-tag-bg': '#e9ecef',
    'color-tag-text': '#495057',
    'color-overlay-light': 'rgba(0, 0, 0, 0.1)',
    'color-freeform': '#4263eb',

    'color-lean': '#862e9c',
    'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.05)',
    'shadow-md': '0 2px 8px rgba(0, 0, 0, 0.08)',
    'shadow-lg': '0 4px 16px rgba(0, 0, 0, 0.1)',
  },
};

const defaultDark: ColorScheme = {
  id: 'default-dark',
  name: 'Default Dark',
  type: 'dark',
  colors: {
    'color-bg': '#1a1b1e',
    'color-bg-secondary': '#25262b',
    'color-bg-tertiary': '#2c2e33',
    'color-surface': '#25262b',
    'color-border': '#373a40',
    'color-border-light': '#2c2e33',
    'color-text': '#c1c2c5',
    'color-text-secondary': '#909296',
    'color-text-tertiary': '#5c5f66',
    'color-primary': '#5c7cfa',
    'color-primary-hover': '#748ffc',
    'color-primary-light': '#1b2559',
    'color-primary-text': '#ffffff',
    'color-danger': '#fa5252',
    'color-danger-hover': '#e03131',
    'color-danger-light': '#3d1b1b',
    'color-success': '#40c057',
    'color-success-light': '#1b3d24',
    'color-warning': '#fab005',
    'color-warning-light': '#3d3013',
    'color-tag-bg': '#373a40',
    'color-tag-text': '#ced4da',
    'color-overlay-light': 'rgba(255, 255, 255, 0.1)',
    'color-freeform': '#5c7cfa',

    'color-lean': '#be4bdb',
    'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.2)',
    'shadow-md': '0 2px 8px rgba(0, 0, 0, 0.3)',
    'shadow-lg': '0 4px 16px rgba(0, 0, 0, 0.4)',
  },
};

const solarizedLight: ColorScheme = {
  id: 'solarized-light',
  name: 'Solarized Light',
  type: 'light',
  colors: {
    'color-bg': '#fdf6e3',
    'color-bg-secondary': '#eee8d5',
    'color-bg-tertiary': '#e8e1cc',
    'color-surface': '#eee8d5',
    'color-border': '#d3cbb7',
    'color-border-light': '#e8e1cc',
    'color-text': '#657b83',
    'color-text-secondary': '#93a1a1',
    'color-text-tertiary': '#b0b8b8',
    'color-primary': '#268bd2',
    'color-primary-hover': '#1a6fb5',
    'color-primary-light': '#e8f1f8',
    'color-primary-text': '#ffffff',
    'color-danger': '#dc322f',
    'color-danger-hover': '#b82725',
    'color-danger-light': 'rgba(220, 50, 47, 0.08)',
    'color-success': '#859900',
    'color-success-light': '#e6f0c8',
    'color-warning': '#b58900',
    'color-warning-light': '#f5edc8',
    'color-tag-bg': '#e8e1cc',
    'color-tag-text': '#586e75',
    'color-overlay-light': 'rgba(0, 0, 0, 0.1)',
    'color-freeform': '#268bd2',

    'color-lean': '#6c71c4',
    'shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.08)',
    'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.1)',
    'shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.12)',
  },
};

const solarizedDark: ColorScheme = {
  id: 'solarized-dark',
  name: 'Solarized Dark',
  type: 'dark',
  colors: {
    'color-bg': '#002b36',
    'color-bg-secondary': '#073642',
    'color-bg-tertiary': '#0d3e4a',
    'color-surface': '#073642',
    'color-border': '#1a4a56',
    'color-border-light': '#0d3e4a',
    'color-text': '#839496',
    'color-text-secondary': '#657b83',
    'color-text-tertiary': '#4a6068',
    'color-primary': '#268bd2',
    'color-primary-hover': '#4aa3e0',
    'color-primary-light': '#0a3d50',
    'color-primary-text': '#ffffff',
    'color-danger': '#dc322f',
    'color-danger-hover': '#e6504d',
    'color-danger-light': 'rgba(220, 50, 47, 0.15)',
    'color-success': '#859900',
    'color-success-light': '#0a3000',
    'color-warning': '#b58900',
    'color-warning-light': '#1a3200',
    'color-tag-bg': '#0d3e4a',
    'color-tag-text': '#93a1a1',
    'color-overlay-light': 'rgba(255, 255, 255, 0.08)',
    'color-freeform': '#268bd2',

    'color-lean': '#6c71c4',
    'shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.3)',
    'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.4)',
    'shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.5)',
  },
};

const nord: ColorScheme = {
  id: 'nord',
  name: 'Nord',
  type: 'dark',
  colors: {
    'color-bg': '#2e3440',
    'color-bg-secondary': '#3b4252',
    'color-bg-tertiary': '#434c5e',
    'color-surface': '#3b4252',
    'color-border': '#4c566a',
    'color-border-light': '#434c5e',
    'color-text': '#eceff4',
    'color-text-secondary': '#d8dee9',
    'color-text-tertiary': '#7b88a1',
    'color-primary': '#88c0d0',
    'color-primary-hover': '#8fbcbb',
    'color-primary-light': '#2e3a40',
    'color-primary-text': '#2e3440',
    'color-danger': '#bf616a',
    'color-danger-hover': '#d08770',
    'color-danger-light': 'rgba(191, 97, 106, 0.15)',
    'color-success': '#a3be8c',
    'color-success-light': '#2a3a28',
    'color-warning': '#ebcb8b',
    'color-warning-light': '#3a3828',
    'color-tag-bg': '#434c5e',
    'color-tag-text': '#d8dee9',
    'color-overlay-light': 'rgba(255, 255, 255, 0.08)',
    'color-freeform': '#88c0d0',

    'color-lean': '#b48ead',
    'shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.3)',
    'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.4)',
    'shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.5)',
  },
};

const dracula: ColorScheme = {
  id: 'dracula',
  name: 'Dracula',
  type: 'dark',
  colors: {
    'color-bg': '#282a36',
    'color-bg-secondary': '#44475a',
    'color-bg-tertiary': '#383a4a',
    'color-surface': '#44475a',
    'color-border': '#6272a4',
    'color-border-light': '#383a4a',
    'color-text': '#f8f8f2',
    'color-text-secondary': '#bfbfb8',
    'color-text-tertiary': '#6272a4',
    'color-primary': '#bd93f9',
    'color-primary-hover': '#caa5ff',
    'color-primary-light': '#2e2842',
    'color-primary-text': '#282a36',
    'color-danger': '#ff5555',
    'color-danger-hover': '#ff7777',
    'color-danger-light': 'rgba(255, 85, 85, 0.15)',
    'color-success': '#50fa7b',
    'color-success-light': '#1a3a28',
    'color-warning': '#f1fa8c',
    'color-warning-light': '#3a3a20',
    'color-tag-bg': '#383a4a',
    'color-tag-text': '#f8f8f2',
    'color-overlay-light': 'rgba(255, 255, 255, 0.08)',
    'color-freeform': '#bd93f9',

    'color-lean': '#ff79c6',
    'shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.3)',
    'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.4)',
    'shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.5)',
  },
};

const gruvboxLight: ColorScheme = {
  id: 'gruvbox-light',
  name: 'Gruvbox Light',
  type: 'light',
  colors: {
    'color-bg': '#fbf1c7',
    'color-bg-secondary': '#ebdbb2',
    'color-bg-tertiary': '#e0d5b5',
    'color-surface': '#ebdbb2',
    'color-border': '#d5c4a1',
    'color-border-light': '#e0d5b5',
    'color-text': '#3c3836',
    'color-text-secondary': '#665c54',
    'color-text-tertiary': '#928374',
    'color-primary': '#458588',
    'color-primary-hover': '#387273',
    'color-primary-light': '#e8ede4',
    'color-primary-text': '#ffffff',
    'color-danger': '#cc241d',
    'color-danger-hover': '#a81a14',
    'color-danger-light': 'rgba(204, 36, 29, 0.08)',
    'color-success': '#98971a',
    'color-success-light': '#dbe5b5',
    'color-warning': '#d79921',
    'color-warning-light': '#f2e5a2',
    'color-tag-bg': '#e0d5b5',
    'color-tag-text': '#504945',
    'color-overlay-light': 'rgba(0, 0, 0, 0.1)',
    'color-freeform': '#458588',

    'color-lean': '#b16286',
    'shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.08)',
    'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.1)',
    'shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.12)',
  },
};

const catppuccinLatte: ColorScheme = {
  id: 'catppuccin-latte',
  name: 'Catppuccin Latte',
  type: 'light',
  colors: {
    'color-bg': '#eff1f5',
    'color-bg-secondary': '#e6e9ef',
    'color-bg-tertiary': '#dce0e8',
    'color-surface': '#e6e9ef',
    'color-border': '#ccd0da',
    'color-border-light': '#dce0e8',
    'color-text': '#4c4f69',
    'color-text-secondary': '#6c6f85',
    'color-text-tertiary': '#8c8fa1',
    'color-primary': '#1e66f5',
    'color-primary-hover': '#1558d8',
    'color-primary-light': '#e0eafc',
    'color-primary-text': '#ffffff',
    'color-danger': '#d20f39',
    'color-danger-hover': '#b50d32',
    'color-danger-light': 'rgba(210, 15, 57, 0.08)',
    'color-success': '#40a02b',
    'color-success-light': '#d8f0d0',
    'color-warning': '#df8e1d',
    'color-warning-light': '#faf0d0',
    'color-tag-bg': '#dce0e8',
    'color-tag-text': '#5c5f77',
    'color-overlay-light': 'rgba(0, 0, 0, 0.08)',
    'color-freeform': '#1e66f5',

    'color-lean': '#8839ef',
    'shadow-sm': '0 1px 3px rgba(76, 79, 105, 0.06)',
    'shadow-md': '0 4px 12px rgba(76, 79, 105, 0.1)',
    'shadow-lg': '0 8px 24px rgba(76, 79, 105, 0.15)',
  },
};

export const COLOR_SCHEMES: ColorScheme[] = [
  defaultLight,
  solarizedLight,
  gruvboxLight,
  catppuccinLatte,
  defaultDark,
  solarizedDark,
  nord,
  dracula,
];

export const DEFAULT_SCHEME_ID = 'default-light';

export function getSchemeById(id: string): ColorScheme {
  return COLOR_SCHEMES.find(s => s.id === id) ?? defaultLight;
}

export function applyColorScheme(scheme: ColorScheme): void {
  const style = document.documentElement.style;
  for (const [key, value] of Object.entries(scheme.colors)) {
    style.setProperty(`--${key}`, value);
  }
  if (scheme.type === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
