export type KeybindingAction =
  | 'toggleFullscreen'
  | 'toggleSidebar'
  | 'togglePanel';

export interface KeybindingMeta {
  action: KeybindingAction;
  label: string;
  scope: string;
  defaultKey: string;
}

export const KEYBINDING_META: KeybindingMeta[] = [
  { action: 'toggleFullscreen', label: 'Toggle fullscreen mode', scope: 'Global', defaultKey: 'f' },
  { action: 'toggleSidebar', label: 'Toggle sidebar', scope: 'Global', defaultKey: 'b' },
  { action: 'togglePanel', label: 'Toggle session side panel', scope: 'Session', defaultKey: 'p' },
];

export type KeybindingsConfig = Record<KeybindingAction, string>;

export const DEFAULT_KEYBINDINGS: KeybindingsConfig = KEYBINDING_META.reduce(
  (acc, m) => ({ ...acc, [m.action]: m.defaultKey }),
  {} as KeybindingsConfig,
);
