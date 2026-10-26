import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { isTheme, nextTheme, resolveTheme, themeBootScript } from './theme';

describe('appearance themes', () => {
  it('accepts only the supported modes', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('night')).toBe(true);
    expect(isTheme('system')).toBe(false);
  });

  it.each(['', 'LIGHT', 'Night ', 'system', 'auto', '<script>alert(1)</script>'])(
    'rejects unsupported stored appearance %s',
    (stored) => {
      expect(isTheme(stored)).toBe(false);
      expect(resolveTheme(stored)).toBe('dark');
    },
  );

  it.each(['light', 'dark', 'night'] as const)(
    'preserves the valid %s appearance preference',
    (stored) => {
      expect(isTheme(stored)).toBe(true);
      expect(resolveTheme(stored)).toBe(stored);
    },
  );

  it('cycles exactly one button through Light, Dark, Night and back to Light', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('night');
    expect(nextTheme('night')).toBe('light');
    let current = resolveTheme('light');
    for (const expected of ['dark', 'night', 'light', 'dark'] as const) {
      current = nextTheme(current);
      expect(current).toBe(expected);
    }
  });

  it('defaults safely to dark', () => {
    expect(resolveTheme(null)).toBe('dark');
    expect(resolveTheme('invalid')).toBe('dark');
    expect(resolveTheme('night')).toBe('night');
  });

  it.each([
    ['light', 'light', 'light'],
    ['dark', 'dark', 'dark'],
    ['night', 'night', 'dark'],
    ['invalid', 'dark', 'dark'],
    [null, 'dark', 'dark'],
  ] as const)('pre-hydration script applies %s preference as %s', (stored, expected, colorScheme) => {
    const root = { dataset: { theme: '' }, style: { colorScheme: '' } };
    runInNewContext(themeBootScript(), {
      localStorage: { getItem: () => stored },
      document: { documentElement: root },
    });
    expect(root.dataset.theme).toBe(expected);
    expect(root.style.colorScheme).toBe(colorScheme);
  });

  it('pre-hydration script safely defaults to dark if browser storage throws', () => {
    const root = { dataset: { theme: '' }, style: { colorScheme: '' } };
    runInNewContext(themeBootScript(), {
      localStorage: { getItem: () => { throw new Error('storage blocked'); } },
      document: { documentElement: root },
    });
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('boot script reads the safe preference and assigns a root theme', () => {
    const script = themeBootScript();
    expect(script).toContain('localStorage.getItem');
    expect(script).toContain("dataset.theme");
    expect(script).toContain("'dark'");
  });
});
