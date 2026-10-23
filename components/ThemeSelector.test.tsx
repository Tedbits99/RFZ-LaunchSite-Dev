import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'ThemeSelector.tsx'), 'utf8');

describe('ThemeSelector keyboard contract', () => {
  it('keeps native buttons and explicitly handles Enter and Space activation', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain("event.key !== 'Enter' && event.key !== ' '");
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('event.currentTarget.click()');
    expect(source).toContain('onKeyDown=');
  });

  it('exposes the selected mode through pressed state and keyboard help', () => {
    expect(source).toContain('aria-pressed={theme === value}');
    expect(source).toContain('aria-keyshortcuts="Enter Space"');
  });
});
