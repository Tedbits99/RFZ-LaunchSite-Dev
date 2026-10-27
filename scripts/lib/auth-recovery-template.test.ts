import { describe, expect, it } from 'vitest';
import { inspectRecoveryTemplate, repairRecoveryTemplate, validateRecoveryTemplate } from './auth-recovery-template.mjs';

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

  it('fails closed when the existing branded template has no auth link', () => {
    expect(() => repairRecoveryTemplate('<html><body>Reset your password</body></html>', callback)).toThrow();
  });

  it('repairs every recovery link in a branded template while preserving unrelated links', () => {
    const template = '<a href="https://runfazone.example">Logo</a><a class="button" href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}">Reset password</a><a href="{{ .ConfirmationURL }}">Open recovery link</a>';
    const repaired = repairRecoveryTemplate(template, callback);
    expect(repaired.match(/\{\{ \.RedirectTo \}\}\?token_hash=/g)).toHaveLength(2);
    expect(repaired).toContain('<a href="https://runfazone.example">Logo</a>');
    expect(validateRecoveryTemplate(repaired, callback)).toEqual({ valid: true, reason: 'valid' });
  });

  it('reports only safe structural metadata for malformed hosted templates', () => {
    const inspection = inspectRecoveryTemplate(
      '<a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}">Reset password for private@example.test</a>',
    );
    expect(inspection).toMatchObject({
      validInput: true,
      anchorCount: 1,
      authLinkCount: 1,
      links: [{ redirectTo: true, tokenHashVariable: true, resetLabel: true, redirectSeparator: '&', canonical: false }],
    });
    expect(JSON.stringify(inspection)).not.toContain('private@example.test');
    expect(JSON.stringify(inspection)).not.toContain('{{ .RedirectTo }}');
  });
});
