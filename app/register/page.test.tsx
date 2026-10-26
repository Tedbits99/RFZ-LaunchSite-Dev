import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import Register from './page';

const sourcePath = join(__dirname, 'page.tsx');
const source = readFileSync(sourcePath, 'utf8');

const EXACT_SUCCESS = 'If the address can receive mail, confirmation instructions will be sent.';
const GENERIC_ERROR = 'Registration is temporarily unavailable. Please try again later.';

describe('register page source invariants (automated static checks)', () => {
  it('is a client component', () => {
    expect(source.trimStart().startsWith("'use client'")).toBe(true);
  });

  it('posts JSON to the existing register API with correct content type', () => {
    expect(source).toContain("fetch('/api/auth/register'");
    expect(source).toContain("method: 'POST'");
    expect(source).toContain("headers: { 'Content-Type': 'application/json' }");
    expect(source).toContain('JSON.stringify({ name, email, password })');
  });

  it('handles HTTP 202 with the exact generic confirmation message', () => {
    expect(source).toContain('res.status === 202');
    expect(source).toContain(`'${EXACT_SUCCESS}'`);
    expect(source.match(new RegExp(EXACT_SUCCESS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length).toBe(1);
  });

  it('handles HTTP 400 with safe inline validation errors and guards the parsed body', () => {
    expect(source).toContain('res.status === 400');
    expect(source).toContain('role="alert"');
    expect(source).toContain('apiError.length < 200');
  });

  it('disables the submit button only while pending', () => {
    expect(source).toContain('disabled={submitState === \'pending\'}');
    expect(source).toContain("submitState === 'pending' ? 'Creating account…' : 'Create Account'");
  });

  it('never logs passwords, tokens, or secrets', () => {
    expect(source).not.toMatch(/console\.(log|error|warn|info|debug)/);
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it('links to the existing login page', () => {
    expect(source).toContain('href="/login"');
  });

  it('renders the reusable password control without social authentication', () => {
    expect(source).toContain('<PasswordInput');
    expect(source).not.toContain('CustomerOAuthButton');
    expect(source).not.toContain('or continue with');
  });

  it('does not navigate the browser to the API endpoint', () => {
    expect(source).not.toMatch(/action=|method="POST"|window\.location/);
  });
});

describe('register page SSR render (executed render check)', () => {
  it('renders the create-account form with all three fields before submission', () => {
    const html = renderToString(React.createElement(Register));
    expect(html).toContain('Create account');
    expect(html).toContain('name="name"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('Create Account');
  });

  it('does not pre-render the success or error panels in the idle state', () => {
    const html = renderToString(React.createElement(Register));
    expect(html).not.toContain(EXACT_SUCCESS);
    expect(html).not.toContain(GENERIC_ERROR);
  });
});
