import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('login page source invariants (automated static checks)', () => {
  it('offers the resend path only for the unconfirmed-email 403, not any 403', () => {
    expect(source).toContain(
      "response.status === 403 && body.error === 'Please confirm your email address to activate your account.'",
    );
    // The bare status-only trigger must be gone so origin-rejected 403s
    // never surface "Resend the confirmation email".
    expect(source).not.toContain('if (response.status === 403) setAwaitingConfirmation(true);');
  });

  it('still surfaces the server error message on failed sign-in', () => {
    expect(source).toContain('setError(body.error ||');
  });

  it('never logs credentials or tokens', () => {
    expect(source).not.toMatch(/console\.(log|error|warn|info|debug)/);
  });
});
