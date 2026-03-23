import { createContext, useContext, useState, useLayoutEffect, useCallback, useMemo, useEffect } from 'react';
import { themeStorage } from '../services/themeStorage';
import type { AutoSwitchSettings } from '../services/themeStorage';
import { getSchemeById, applyColorScheme } from '../colorSchemes';
import type { ColorScheme } from '../colorSchemes';

interface ThemeContextValue {
  schemeId: string;
  scheme: ColorScheme;
  setScheme: (id: string) => void;
  autoSwitch: AutoSwitchSettings;
  setAutoSwitch: (settings: AutoSwitchSettings) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSchemeForCurrentTime(settings: AutoSwitchSettings): string {
  const hour = new Date().getHours();
  if (hour >= settings.dayStartHour && hour < settings.nightStartHour) {
    return settings.lightSchemeId;
  }
  return settings.darkSchemeId;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [autoSwitch, setAutoSwitchState] = useState<AutoSwitchSettings>(
    () => themeStorage.getAuto()
  );

  const [schemeId, setSchemeId] = useState<string>(() => {
    const auto = themeStorage.getAuto();
    if (auto.enabled) {
      return getSchemeForCurrentTime(auto);
    }
    return themeStorage.get();
  });

  const scheme = useMemo(() => getSchemeById(schemeId), [schemeId]);

  const setScheme = useCallback((id: string) => {
    setSchemeId(id);
    themeStorage.save(id);
    setAutoSwitchState(prev => {
      if (prev.enabled) {
        const updated = { ...prev, enabled: false };
        themeStorage.saveAuto(updated);
        return updated;
      }
      return prev;
    });
  }, []);

  const setAutoSwitch = useCallback((settings: AutoSwitchSettings) => {
    setAutoSwitchState(settings);
    themeStorage.saveAuto(settings);
    if (settings.enabled) {
      const id = getSchemeForCurrentTime(settings);
      setSchemeId(id);
      themeStorage.save(id);
    }
  }, []);

  useEffect(() => {
    if (!autoSwitch.enabled) return;

    const interval = setInterval(() => {
      const id = getSchemeForCurrentTime(autoSwitch);
      setSchemeId(prev => {
        if (prev !== id) {
          themeStorage.save(id);
          return id;
        }
        return prev;
      });
    }, 60_000);

    return () => clearInterval(interval);
  }, [autoSwitch]);

  useLayoutEffect(() => {
    applyColorScheme(scheme);
  }, [scheme]);

  return (
    <ThemeContext.Provider value={{ schemeId, scheme, setScheme, autoSwitch, setAutoSwitch }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
