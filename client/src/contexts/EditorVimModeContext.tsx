import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { editorStorage } from '../services/editorStorage';

interface EditorVimModeContextValue {
  vimMode: boolean;
  setVimMode: (enabled: boolean) => void;
  toggle: () => void;
}

const EditorVimModeContext = createContext<EditorVimModeContextValue | null>(null);

export function EditorVimModeProvider({ children }: { children: ReactNode }) {
  const [vimMode, setVimModeState] = useState(() => editorStorage.getVimMode());

  const setVimMode = useCallback((enabled: boolean) => {
    setVimModeState(enabled);
    editorStorage.saveVimMode(enabled);
  }, []);

  const toggle = useCallback(() => {
    setVimModeState(prev => {
      const next = !prev;
      editorStorage.saveVimMode(next);
      return next;
    });
  }, []);

  return (
    <EditorVimModeContext.Provider value={{ vimMode, setVimMode, toggle }}>
      {children}
    </EditorVimModeContext.Provider>
  );
}

export function useEditorVimMode(): EditorVimModeContextValue {
  const context = useContext(EditorVimModeContext);
  if (!context) {
    throw new Error('useEditorVimMode must be used within an EditorVimModeProvider');
  }
  return context;
}
