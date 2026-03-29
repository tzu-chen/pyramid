import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { editorStorage } from '../services/editorStorage';

interface EditorFontSizeContextValue {
  fontSize: number;
  increase: () => void;
  decrease: () => void;
  reset: () => void;
}

const EditorFontSizeContext = createContext<EditorFontSizeContextValue | null>(null);

export function EditorFontSizeProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSizeState] = useState(() => editorStorage.getFontSize());

  const setFontSize = useCallback((size: number) => {
    const clamped = Math.max(editorStorage.MIN_FONT_SIZE, Math.min(editorStorage.MAX_FONT_SIZE, size));
    setFontSizeState(clamped);
    editorStorage.saveFontSize(clamped);
  }, []);

  const increase = useCallback(() => {
    setFontSizeState(prev => {
      const next = Math.min(editorStorage.MAX_FONT_SIZE, prev + 1);
      editorStorage.saveFontSize(next);
      return next;
    });
  }, []);

  const decrease = useCallback(() => {
    setFontSizeState(prev => {
      const next = Math.max(editorStorage.MIN_FONT_SIZE, prev - 1);
      editorStorage.saveFontSize(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setFontSize(editorStorage.DEFAULT_FONT_SIZE);
  }, [setFontSize]);

  return (
    <EditorFontSizeContext.Provider value={{ fontSize, increase, decrease, reset }}>
      {children}
    </EditorFontSizeContext.Provider>
  );
}

export function useEditorFontSize(): EditorFontSizeContextValue {
  const context = useContext(EditorFontSizeContext);
  if (!context) {
    throw new Error('useEditorFontSize must be used within an EditorFontSizeProvider');
  }
  return context;
}
