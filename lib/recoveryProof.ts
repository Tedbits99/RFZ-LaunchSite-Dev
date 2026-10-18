import type { CookieOptions } from '@supabase/ssr';
import { RECOVERY_PROOF_COOKIE, RECOVERY_PROOF_MAX_AGE_SECONDS } from '@/lib/authSessionConfig';

// Non-cryptographic random is fine: the proof is an opaque, short-lived,
// single-purpose marker whose security comes from the recovery-namespace
// session the callback just established, not from the marker value itself.
function randomProofToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export type RecoveryProof = { name: string; value: string; options: CookieOptions };

function proofCookie(maxAge: number): RecoveryProof {
  return {
    name: RECOVERY_PROOF_COOKIE,
    value: '',
    options: {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/auth/reset-password',
      maxAge,
    },
  };
}

export function newRecoveryProofCookie(): RecoveryProof {
  return { ...proofCookie(RECOVERY_PROOF_MAX_AGE_SECONDS), value: randomProofToken() };
}

export function clearRecoveryProofCookie(): RecoveryProof {
  return proofCookie(0);
}

export function isRecoveryProofPresent(cookies: { get(name: string): { value: string } | undefined }): boolean {
  const cookie = cookies.get(RECOVERY_PROOF_COOKIE);
  return Boolean(cookie && cookie.value.length >= 32);
}
