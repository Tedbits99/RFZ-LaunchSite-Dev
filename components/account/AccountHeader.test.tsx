import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'AccountHeader.tsx'), 'utf8');

describe('account navigation', () => {
  it('uses the customer logout endpoint and returns to login', () => {
    expect(source).toContain("fetch('/api/auth/logout'");
    expect(source).toContain("router.replace('/login')");
    expect(source).toContain('credentials: \'same-origin\'');
  });

  it('exposes account, order, and profile navigation', () => {
    expect(source).toContain('href="/account"');
    expect(source).toContain('href="/account/orders"');
    expect(source).toContain('href="/account/profile"');
  });
});
