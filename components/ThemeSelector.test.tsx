import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ThemeSelector from './ThemeSelector';
import { ThemeProvider } from './ThemeProvider';

describe('one-button appearance selector', () => {
  it('renders exactly one accessible button with the next-mode label', () => {
    const markup = renderToStaticMarkup(
      <ThemeProvider><ThemeSelector /></ThemeProvider>,
    );
    expect(markup.match(/<button\b/g)).toHaveLength(1);
    expect(markup).toContain('Appearance: Dark. Switch to Night mode');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('transition-transform');
    expect(markup).toContain('motion-reduce:transition-none');
  });

  it('remains a single icon-only button in compact mode', () => {
    const markup = renderToStaticMarkup(
      <ThemeProvider><ThemeSelector compact /></ThemeProvider>,
    );
    expect(markup.match(/<button\b/g)).toHaveLength(1);
    expect(markup).not.toContain('>Dark</span>');
    expect(markup).toContain('aria-label="Appearance: Dark. Switch to Night mode"');
  });

  it('keeps the control away from mobile navigation and desktop links', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    expect(css).toContain('max-width: 1023px');
    expect(css).toContain('bottom: calc(1rem + env(safe-area-inset-bottom, 0px))');
    expect(css).toContain('header.sticky > div:first-child { padding-right: 7.5rem; }');
  });
});
