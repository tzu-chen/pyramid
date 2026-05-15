export interface ColorScheme {
  id: string;
  name: string;
  type: 'light' | 'dark';
  colors: Record<string, string>;
}

const light: ColorScheme = {
  id: 'light',
  name: 'Light',
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

const dark: ColorScheme = {
  id: 'dark',
  name: 'Dark',
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

export const COLOR_SCHEMES: ColorScheme[] = [light, dark];

export const DEFAULT_SCHEME_ID = 'light';
export const DEFAULT_LIGHT_SCHEME_ID = 'light';
export const DEFAULT_DARK_SCHEME_ID = 'dark';

export function getSchemeById(id: string): ColorScheme {
  return COLOR_SCHEMES.find(s => s.id === id) ?? light;
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
