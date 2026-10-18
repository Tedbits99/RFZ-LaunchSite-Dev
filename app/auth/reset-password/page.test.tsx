import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import ResetPasswordPage from './page';

const sourcePath = join(__dirname, 'page.tsx');
const source = readFileSync(sourcePath, 'utf8');

const GENERIC_INVALID = 'This reset link is invalid or has expired. Please request a new one.';
const GENERIC_OK = 'Password updated. You can now sign in with your new password.';

describe('reset password page source invariants (automated static checks)', () => {
  it('is a client component', () => {
    expect(source.trimStart().startsWith("'use client'")).toBe(true);
  });

  it('requires a verified authenticated session via getUser before allowing a password change', () => {
    expect(source).toContain('await supabase.auth.getUser()');
    expect(source).toContain('if (!userData?.user)');
    expect(source).not.toContain('auth.getSession()');
    expect(source).not.toContain('auth.signInWithPassword');
    expect(source).not.toContain('auth.signUp');
  });

  it('updates the password through the authenticated recovery session', () => {
    expect(source).toContain("supabase.auth.updateUser({ password })");
  });

  it('signs out after a successful password update', () => {
    expect(source).toContain('await supabase.auth.signOut()');
  });

  it('preserves the password length requirements in the form', () => {
    expect(source).toContain('minLength={8}');
    expect(source).toContain('maxLength={128}');
    expect(source).toContain('autoComplete="new-password"');
  });

  it('shows only generic error messages and never leaks provider details', () => {
    expect(source).toContain(`'${GENERIC_INVALID}'`);
    expect(source).toContain(`'${GENERIC_OK}'`);
    expect(source).not.toMatch(/console\.(log|error|warn|info|debug)/);
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(source).not.toMatch(/access_token|refresh_token|token_hash/);
  });

  it('does not expose recovery codes or tokens from the URL', () => {
    expect(source).not.toMatch(/searchParams|window\.location|URLSearchParams/);
  });

  it('links to the existing login page', () => {
    expect(source).toContain('href="/login"');
  });
});

describe('reset password page SSR render (executed render check)', () => {
  it('renders the new-password form with a single password field before submission', () => {
    const html = renderToString(React.createElement(ResetPasswordPage));
    expect(html).toContain('Choose a new password');
    expect(html).toContain('name="password"');
    expect(html).toContain('type="password"');
    expect(html).toContain('Update password');
  });

  it('does not pre-render the success or error panels in the idle state', () => {
    const html = renderToString(React.createElement(ResetPasswordPage));
    expect(html).not.toContain(GENERIC_OK);
    expect(html).not.toContain(GENERIC_INVALID);
  });
});
