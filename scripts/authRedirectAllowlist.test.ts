import { describe, expect, it } from 'vitest';
import {
  inspectAuthRedirectAllowlist,
  mergeAuthRedirectAllowlist,
  normalizeAuthRedirectAllowlist,
} from './lib/auth-redirect-allowlist.mjs';

const callback = 'https://pr82-123456abcdef-runfazone-preview.mondigoted732.workers.dev/auth/callback';
const wildcard = 'https://pr82-*-runfazone-preview.mondigoted732.workers.dev/auth/callback';

describe('Supabase Auth redirect allowlist normalization', () => {
  it('parses comma-delimited Management API values', () => {
    expect(normalizeAuthRedirectAllowlist('https://site.test/cb, https://other.test/**'))
      .toEqual(['https://site.test/cb', 'https://other.test/**']);
  });

  it('parses newline-delimited values and arrays without losing entries', () => {
    expect(normalizeAuthRedirectAllowlist(['https://one.test/cb\nhttps://two.test/**', ' https://three.test/cb ']))
      .toEqual(['https://one.test/cb', 'https://two.test/**', 'https://three.test/cb']);
  });

  it('recognizes an exact protected candidate callback', () => {
    expect(inspectAuthRedirectAllowlist(callback, callback, wildcard).callbackAllowed).toBe(true);
  });

  it('recognizes the narrowly scoped PR wildcard', () => {
    expect(inspectAuthRedirectAllowlist(wildcard, callback, wildcard)).toMatchObject({
      wildcardRule: true,
      callbackAllowed: true,
    });
  });

  it('does not accept another PR number or an unrelated host', () => {
    expect(inspectAuthRedirectAllowlist(
      'https://pr69-*-runfazone-preview.mondigoted732.workers.dev/auth/callback,https://evil.test/**',
      callback,
      wildcard,
    ).callbackAllowed).toBe(false);
  });

  it('merges without dropping existing rules or duplicating the candidate', () => {
    expect(mergeAuthRedirectAllowlist(`https://site.test/cb,${wildcard}`, callback, wildcard))
      .toBe(`https://site.test/cb,${wildcard},${callback}`);
  });
});
