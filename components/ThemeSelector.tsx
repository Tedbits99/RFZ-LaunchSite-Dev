'use client';

import { useState } from 'react';
import { Moon, Sun, Star } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { nextTheme, type Theme } from '@/lib/theme';

const icons = { light: Sun, dark: Moon, night: Star } satisfies Record<Theme, typeof Sun>;
const names = { light: 'Light', dark: 'Dark', night: 'Night' } satisfies Record<Theme, string>;

/**
 * One accessible button for all three appearance modes.
 * On each click the icon makes one complete turn and the next theme is saved
 * by ThemeProvider. No timers or reflows are required for the animation.
 */
export default function ThemeSelector({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [turns, setTurns] = useState(0);
  const Icon = icons[theme];
  const following = nextTheme(theme);

  const cycle = () => {
    setTheme(following);
    setTurns((previous) => previous + 1);
  };

  return (
    <button
      type="button"
      className="theme-selector inline-flex min-h-10 min-w-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[var(--rfz-line)] bg-[var(--rfz-surface)] px-3 py-2 text-xs font-semibold text-[var(--rfz-text)] shadow-md transition-colors hover:border-[var(--rfz-accent)] hover:bg-[var(--rfz-surface-raised)] focus-visible:outline focus-visible:outline-2"
      aria-label={`Appearance: ${names[theme]}. Switch to ${names[following]} mode`}
      title={`Current: ${names[theme]}. Click for ${names[following]} mode`}
      onClick={cycle}
    >
      <span
        className="inline-flex shrink-0 items-center justify-center transition-transform duration-500 ease-in-out motion-reduce:transition-none"
        style={{ transform: `rotate(${turns * 360}deg)` }}
        aria-hidden="true"
      >
        <Icon size={17} strokeWidth={2} />
      </span>
      {!compact && <span className="hidden sm:inline">{names[theme]}</span>}
    </button>
  );
}
