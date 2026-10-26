'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { resolveTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';

declare global {
  interface Window {
    __rfzThemeHydrated?: boolean;
  }
}

type ThemeContextValue = { theme: Theme; setTheme: (theme: Theme) => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    window.__rfzThemeHydrated = true;
    const initial = resolveTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
    setThemeState(initial);
    document.documentElement.dataset.theme = initial;
    document.documentElement.style.colorScheme = initial === 'light' ? 'light' : 'dark';
    // Expose a stable browser-acceptance and accessibility synchronization
    // point after the boot script preference has been reconciled with React.
    document.documentElement.dataset.themeReady = 'true';
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next === 'light' ? 'light' : 'dark';
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
