import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('customer OAuth callback safety', () => {
  it('uses the dedicated customer session namespace', () => {
    expect(source).toContain("createCustomerServerClient");
    expect(source).not.toContain('createSupabaseServerClient');
    expect(source).toContain('exchangeCodeForSession(code)');
  });

  it('accepts only the configured same-origin callback and fixed destinations', () => {
    expect(source).toContain('request.nextUrl.origin !== origin');
    expect(source).toContain("${origin}/account");
    expect(source).not.toContain('request.nextUrl.searchParams.get(\'next\')');
  });

  it('fails closed for missing, provider-error, unconfirmed, missing and inactive profiles', () => {
    expect(source).toContain("params.has('error')");
    expect(source).toContain("!code");
    expect(source).toContain('!user.email_confirmed_at');
    expect(source).toContain('!profile');
    expect(source).toContain("profile.status !== 'active'");
  });
});
