'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { resolveTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';

type ThemeContextValue = { theme: Theme; setTheme: (theme: Theme) => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const initial = resolveTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
    setThemeState(initial);
    document.documentElement.dataset.theme = initial;
    document.documentElement.style.colorScheme = initial === 'light' ? 'light' : 'dark';
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
  // A few server-rendered route probes render a page component in isolation.
  // Keep the selector presentational in that context while the real app still
  // receives the stateful provider from the root layout.
  if (!context) {
    return {
      theme: 'dark' as Theme,
      setTheme: (next: Theme) => {
        if (typeof document !== 'undefined') document.documentElement.dataset.theme = next;
        if (typeof window !== 'undefined') window.localStorage.setItem(THEME_STORAGE_KEY, next);
      },
    };
  }
  return context;
}
