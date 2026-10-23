'use client';

import { Moon, Sun, Star } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useTheme } from './ThemeProvider';
import type { Theme } from '@/lib/theme';

const options: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'night', label: 'Night', Icon: Star },
];

export default function ThemeSelector({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const activateWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Keep keyboard activation on the same path as pointer activation. Calling
    // the native button click is reliable across hydrated and mobile Chromium
    // while retaining the browser's button focus and keyboard semantics.
    event.preventDefault();
    event.currentTarget.click();
  };
  return <fieldset className={`theme-selector inline-flex items-center gap-1 rounded-xl border border-[var(--rfz-line)] bg-[var(--rfz-surface)] p-1 shadow-sm ${compact ? '' : 'px-1.5'}`} aria-label="Appearance">
    <legend className="sr-only">Appearance</legend>
    {options.map(({ value, label, Icon }) => <button key={value} type="button" data-theme-option={value} aria-pressed={theme === value} aria-label={`${label} mode`} aria-keyshortcuts="Enter Space" title={`${label} mode`} onClick={() => setTheme(value)} onKeyDown={activateWithKeyboard} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold transition ${theme === value ? 'bg-[var(--rfz-accent-soft)] text-[var(--rfz-accent)] shadow-sm' : 'text-[var(--rfz-muted)] hover:bg-[var(--rfz-surface-raised)] hover:text-[var(--rfz-text)]'}`}><Icon size={14} aria-hidden="true" />{!compact && <span>{label}</span>}</button>)}
  </fieldset>;
}
