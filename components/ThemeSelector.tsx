'use client';

import { Moon, Sun, Star } from 'lucide-react';
import { useState } from 'react';
import { useTheme } from './ThemeProvider';
import type { Theme } from '@/lib/theme';

const THEME_ORDER: Theme[] = ['light', 'dark', 'night'];
const THEME_LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', night: 'Night' };
const THEME_ICONS: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, night: Star };

export default function ThemeSelector({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const { theme, setTheme } = useTheme();
  const [animating, setAnimating] = useState(false);
  const currentTheme = THEME_ORDER.includes(theme) ? theme : 'dark';
  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(currentTheme) + 1) % THEME_ORDER.length];
  const Icon = THEME_ICONS[currentTheme];

  const cycleTheme = () => {
    setAnimating(true);
    setTheme(nextTheme);
    window.setTimeout(() => setAnimating(false), 320);
  };

  return <div className={`theme-selector inline-flex items-center rounded-xl border border-[var(--rfz-line)] bg-[var(--rfz-surface)] p-1 shadow-sm ${className}`} data-theme-selector>
    <button
      type="button"
      data-theme-toggle
      data-current-theme={currentTheme}
      data-next-theme={nextTheme}
      aria-label={`Current theme: ${THEME_LABELS[currentTheme]}. Switch to ${THEME_LABELS[nextTheme]} mode`}
      aria-keyshortcuts="Enter Space"
      title={`Switch to ${THEME_LABELS[nextTheme]} mode`}
      onClick={cycleTheme}
      className={`theme-selector-toggle inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg px-2 text-[11px] font-semibold text-[var(--rfz-accent)] transition hover:bg-[var(--rfz-surface-raised)] focus-visible:outline-none ${animating ? 'is-animating' : ''}`}
    >
      <Icon size={compact ? 16 : 17} aria-hidden="true" />
      <span className="sr-only">{THEME_LABELS[currentTheme]} mode. Switch to {THEME_LABELS[nextTheme]} mode.</span>
    </button>
  </div>;
}
