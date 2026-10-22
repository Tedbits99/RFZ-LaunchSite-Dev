import { describe, expect, it } from 'vitest';
import { isTheme, resolveTheme, themeBootScript } from './theme';

describe('appearance themes', () => {
  it('accepts only the supported modes', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('night')).toBe(true);
    expect(isTheme('system')).toBe(false);
  });

  it('defaults safely to dark', () => {
    expect(resolveTheme(null)).toBe('dark');
    expect(resolveTheme('invalid')).toBe('dark');
    expect(resolveTheme('night')).toBe('night');
  });

  it('boot script reads the safe preference and assigns a root theme', () => {
    const script = themeBootScript();
    expect(script).toContain('localStorage.getItem');
    expect(script).toContain("dataset.theme");
    expect(script).toContain("'dark'");
  });
});
