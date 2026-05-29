import { useEffect } from 'react';
import { useKeybindings } from '../contexts/KeybindingsContext';
import type { KeybindingAction } from '../types/keybindings';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  // CodeMirror editors render into a contenteditable; the check above covers it,
  // but guard the wrapping element too for safety.
  if (target.closest('.cm-editor')) return true;
  return false;
}

export function useKeyboardShortcut(
  action: KeybindingAction,
  handler: () => void,
  enabled: boolean = true,
) {
  const { keybindings } = useKeybindings();
  const expected = keybindings[action];

  useEffect(() => {
    if (!enabled || !expected) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key.toLowerCase() !== expected.toLowerCase()) return;
      e.preventDefault();
      handler();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expected, handler, enabled]);
}
