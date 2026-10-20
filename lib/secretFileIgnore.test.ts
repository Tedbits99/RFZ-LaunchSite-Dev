import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('local environment file ignore rules', () => {
  it('ignores environment-specific files while keeping the placeholder example trackable', () => {
    const rules = readFileSync(join(process.cwd(), '.gitignore'), 'utf8').split(/\r?\n/);
    expect(rules).toContain('.env');
    expect(rules).toContain('.env*.local');
    expect(rules).toContain('.env.*');
    expect(rules).toContain('!.env.example');
  });
});
