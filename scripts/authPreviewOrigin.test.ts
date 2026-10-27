import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const helper = resolve(process.cwd(), 'scripts/lib/auth-preview-origin.sh');

function parseOrigin(origin: string) {
  const output = execFileSync('bash', [
    '-c',
    'source "$1" && auth_preview_origin_parse "$2" && printf "%s|%s|%s" "$AUTH_PREVIEW_PR" "$AUTH_PREVIEW_SHA_PREFIX" "$AUTH_PREVIEW_CALLBACK_WILDCARD"',
    '_',
    helper,
    origin,
  ], { encoding: 'utf8' });
  return output;
}

describe('protected candidate auth origin policy', () => {
  it.each([
    [
      'https://pr69-0123456789ab-runfazone-preview.mondigoted732.workers.dev',
      '69|0123456789ab|https://pr69-*-runfazone-preview.mondigoted732.workers.dev/auth/callback',
    ],
    [
      'https://pr82-abcdef012345-runfazone-preview.mondigoted732.workers.dev',
      '82|abcdef012345|https://pr82-*-runfazone-preview.mondigoted732.workers.dev/auth/callback',
    ],
  ])('accepts only the pinned immutable PR candidate origin: %s', (origin, expected) => {
    expect(parseOrigin(origin)).toBe(expected);
  });

  it.each([
    'https://pr83-0123456789ab-runfazone-preview.mondigoted732.workers.dev',
    'https://pr82-0123456789a-runfazone-preview.mondigoted732.workers.dev',
    'https://pr82-0123456789ab-runfazone-preview.attacker.workers.dev',
    'http://pr82-0123456789ab-runfazone-preview.mondigoted732.workers.dev',
    'https://pr82-0123456789ab-runfazone-preview.mondigoted732.workers.dev/path',
  ])('rejects unapproved or malformed candidate origin: %s', (origin) => {
    const result = spawnSync('bash', [
      '-c',
      'source "$1" && auth_preview_origin_parse "$2"',
      '_',
      helper,
      origin,
    ]);
    expect(result.status).not.toBe(0);
  });
});
