import { useState, useCallback } from 'react';
import { editorStorage } from '../services/editorStorage';

export function useEditorFontSize() {
  const [fontSize, setFontSizeState] = useState(() => editorStorage.getFontSize());

  const setFontSize = useCallback((size: number) => {
    const clamped = Math.max(editorStorage.MIN_FONT_SIZE, Math.min(editorStorage.MAX_FONT_SIZE, size));
    setFontSizeState(clamped);
    editorStorage.saveFontSize(clamped);
  }, []);

  const increase = useCallback(() => {
    setFontSize(fontSize + 1);
  }, [fontSize, setFontSize]);

  const decrease = useCallback(() => {
    setFontSize(fontSize - 1);
  }, [fontSize, setFontSize]);

  const reset = useCallback(() => {
    setFontSize(editorStorage.DEFAULT_FONT_SIZE);
  }, [setFontSize]);

  return { fontSize, increase, decrease, reset };
}
