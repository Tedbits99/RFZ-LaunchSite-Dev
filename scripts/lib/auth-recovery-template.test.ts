import { describe, expect, it } from 'vitest';
import { repairRecoveryTemplate, validateRecoveryTemplate } from './auth-recovery-template.mjs';

const callback = 'https://pr82-a1b2c3d4e5f6-runfazone-preview.mondigoted732.workers.dev/auth/callback';
const brandedTemplate = '<html><body><table class="brand"><tr><td><a class="reset-button" href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}">Reset your password</a></td></tr><tr><td>RunFazone</td></tr></table></body></html>';

describe('hosted password-recovery email URL contract', () => {
  it('rejects the malformed origin/callback query construction shown in the owner report', () => {
    expect(validateRecoveryTemplate(brandedTemplate, callback)).toEqual({
      valid: false,
      reason: 'recovery_href_contract_mismatch',
    });
    expect(validateRecoveryTemplate(
      brandedTemplate.replace('{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}', '{{ .RedirectTo }}&token_hash={{ .TokenHash }}'),
      callback,
    ).valid).toBe(false);
  });

  it('repairs only the recovery href and preserves the existing branded markup', () => {
    const repaired = repairRecoveryTemplate(brandedTemplate, callback);
    expect(repaired).toContain('class="brand"');
    expect(repaired).toContain('class="reset-button"');
    expect(repaired).toContain('RunFazone');
    expect(repaired).toContain('{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=recovery');
    expect(repaired.replace('{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=recovery', 'RECOVERY_HREF'))
      .toBe(brandedTemplate.replace('{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}', 'RECOVERY_HREF'));
    expect(validateRecoveryTemplate(repaired, callback)).toEqual({ valid: true, reason: 'valid' });
  });

  it.each([
    'http://pr82-a1b2c3d4e5f6-runfazone-preview.mondigoted732.workers.dev/auth/callback',
    'https://evil.example/auth/callback',
    'https://pr82-a1b2c3d4e5f6-runfazone-preview.mondigoted732.workers.dev/auth/callback?next=https://evil.example',
  ])('refuses an untrusted callback base: %s', (untrustedCallback) => {
    expect(() => repairRecoveryTemplate(brandedTemplate, untrustedCallback)).toThrow();
  });

  it('fails closed when the existing branded template has no unique auth link', () => {
    expect(() => repairRecoveryTemplate('<html><body>Reset your password</body></html>', callback)).toThrow();
    expect(() => repairRecoveryTemplate(
      '<a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}">One</a><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}">Two</a>',
      callback,
    )).toThrow();
  });
});
