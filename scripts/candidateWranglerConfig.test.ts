import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const checker = resolve(process.cwd(), 'scripts/verify-candidate-wrangler-config.mjs');
const configPath = resolve(process.cwd(), 'wrangler.jsonc');

describe('private candidate Wrangler config gate', () => {
  it('accepts the existing asset-only runfazone-preview config', () => {
    expect(execFileSync('node', [checker, configPath], { encoding: 'utf8' })).toContain('CANDIDATE_WRANGLER_CONFIG_PASS');
  });

  it.each([
    { name: 'other-worker' },
    { routes: ['example.com/*'] },
    { vars: { SUPABASE_SERVICE_ROLE_KEY: 'not-a-secret' } },
    { assets: { directory: '.open-next/assets', binding: 'ASSETS', run_worker_first: true } },
  ])('rejects unapproved extra Worker configuration: %j', (extra) => {
    const temp = mkdtempSync(join(tmpdir(), 'rfz-candidate-config-'));
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      Object.assign(config, extra);
      const invalidPath = join(temp, 'wrangler.jsonc');
      writeFileSync(invalidPath, JSON.stringify(config));
      const result = spawnSync('node', [checker, invalidPath], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('BLOCKED: candidate Wrangler configuration');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
