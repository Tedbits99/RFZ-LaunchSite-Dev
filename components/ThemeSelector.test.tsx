import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'ThemeSelector.tsx'), 'utf8');

describe('ThemeSelector keyboard contract', () => {
  it('uses one native button with pre-hydration keyboard support', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('data-theme-toggle');
    expect(source).toContain('onClick={cycleTheme}');
  });

  it('exposes current and next modes through an accessible label', () => {
    expect(source).toContain('data-current-theme={currentTheme}');
    expect(source).toContain('data-next-theme={nextTheme}');
    expect(source).toContain('Current theme:');
    expect(source).toContain('aria-keyshortcuts="Enter Space"');
  });
});
