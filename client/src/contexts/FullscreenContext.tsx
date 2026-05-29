import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

interface FullscreenContextValue {
  /** When true, the sidebar and session toolbar are hidden for an immersive view. */
  fullscreen: boolean;
  setFullscreen: (value: boolean) => void;
  toggle: () => void;
}

const FullscreenContext = createContext<FullscreenContextValue | null>(null);

export function FullscreenProvider({ children }: { children: ReactNode }) {
  // Transient on purpose — fullscreen is a per-visit view state, not a persisted setting.
  const [fullscreen, setFullscreen] = useState(false);

  const toggle = useCallback(() => setFullscreen(prev => !prev), []);

  const value = useMemo<FullscreenContextValue>(
    () => ({ fullscreen, setFullscreen, toggle }),
    [fullscreen, toggle],
  );

  return <FullscreenContext.Provider value={value}>{children}</FullscreenContext.Provider>;
}

export function useFullscreen(): FullscreenContextValue {
  const ctx = useContext(FullscreenContext);
  if (!ctx) throw new Error('useFullscreen must be used within a FullscreenProvider');
  return ctx;
}
