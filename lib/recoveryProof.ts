import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

import { RECOVERY_PROOF_COOKIE, RECOVERY_PROOF_MAX_AGE_SECONDS } from '@/lib/authSessionConfig';

export const RECOVERY_PROOF_HMAC_SECRET_ENV = 'RFZ_RECOVERY_PROOF_HMAC_SECRET';
export const RECOVERY_PROOF_PURPOSE = 'password-reset';

const MIN_SECRET_BYTES = 32;
const MAX_AGE_SECONDS = Math.min(RECOVERY_PROOF_MAX_AGE_SECONDS, 600);

/**
 * SHA-256 fingerprint of the recovery session's access token. Both the
 * callback (from exchangeCodeForSession().data.session.access_token) and the
 * completion endpoint (from getSession().data.session.access_token) derive
 * the same binding value; the raw token itself is never stored or
 * transmitted in the proof cookie. If the access token is refreshed the
 * fingerprint no longer matches and the reset fails closed — the user
 * requests a new reset link.
 */
export function sessionFingerprint(accessToken: string): string {
  return createHash('sha256').update(accessToken, 'utf8').digest('hex');
}

/**
 * HMAC-SHA256 signed recovery proof: an opaque random token plus a signature
 * that binds the token to the verified recovery Auth user ID, the recovery
 * session fingerprint, the password-reset purpose and an absolute expiry.
 * Only the signed statement travels in the HttpOnly cookie; it never
 * contains passwords, bearer tokens, PKCE verifiers or the signing secret.
 */
export type RecoveryProofClaims = {
  token: string;
  userId: string;
  sessionFingerprint: string;
  purpose: string;
  exp: number;
};

export type RecoveryProof = { name: string; value: string; options: CookieOptions };
export type RecoveryProofFailureCode =
  | 'missing_or_oversized'
  | 'secret_unavailable'
  | 'malformed_proof'
  | 'malformed_claims'
  | 'wrong_purpose'
  | 'expired'
  | 'invalid_signature'
  | 'user_mismatch'
  | 'session_mismatch';

type RecoveryProofVerification =
  | { ok: true; claims: RecoveryProofClaims }
  | { ok: false; reason: RecoveryProofFailureCode };

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
  expires?: Date;
}

export function recoveryProofSecretAvailable(): boolean {
  return typeof window === 'undefined' && isUsableSecret(process.env[RECOVERY_PROOF_HMAC_SECRET_ENV]);
}

function isUsableSecret(secret: string | undefined): boolean {
  return typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= MIN_SECRET_BYTES;
}

function getSecret(): string {
  if (typeof window !== 'undefined') throw new Error('Recovery proof signing is server-only.');
  const secret = process.env[RECOVERY_PROOF_HMAC_SECRET_ENV];
  if (typeof secret !== 'string' || !isUsableSecret(secret)) {
    throw new Error('Recovery proof signing secret is unavailable.');
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function proofCookie(maxAge: number, expires?: Date): RecoveryProof {
  return {
    name: RECOVERY_PROOF_COOKIE,
    value: '',
    options: {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/auth/reset-password',
      maxAge,
      ...(expires ? { expires } : {}),
    },
  };
}

export function newRecoveryProofCookie(binding: { userId: string; sessionFingerprint: string }): RecoveryProof {
  const secret = getSecret();
  const token = randomBytes(24).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const signedClaims: RecoveryProofClaims = {
    token,
    userId: binding.userId,
    sessionFingerprint: binding.sessionFingerprint,
    purpose: RECOVERY_PROOF_PURPOSE,
    exp,
  };
  const payload = Buffer.from(JSON.stringify(signedClaims), 'utf8').toString('base64url');
  const sig = sign(payload, secret);
  return { ...proofCookie(MAX_AGE_SECONDS), value: `${payload}.${sig}` };
}

export function clearRecoveryProofCookie(): RecoveryProof {
  // Runtime cookie serializers may drop maxAge: 0, so the clear must also
  // carry an explicit past Expires date to guarantee genuine deletion.
  return proofCookie(0, new Date(0));
}

export function verifyRecoveryProof(
  cookieValue: string | undefined,
  expected: { userId: string; sessionFingerprint: string },
): RecoveryProofVerification {
  if (typeof cookieValue !== 'string' || cookieValue.length === 0 || cookieValue.length > 4096) {
    return { ok: false, reason: 'missing_or_oversized' };
  }

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return { ok: false, reason: 'secret_unavailable' };
  }

  const parts = cookieValue.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed_proof' };
  const [payload, sig] = parts;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed_claims' };
  }

  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'malformed_claims' };
  const record = claims as Partial<RecoveryProofClaims>;
  if (
    typeof record.token !== 'string' ||
    !/^[0-9a-f]{48}$/.test(record.token) ||
    typeof record.userId !== 'string' ||
    !record.userId ||
    record.userId.length > 128 ||
    typeof record.sessionFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.sessionFingerprint) ||
    typeof record.exp !== 'number' ||
    !Number.isFinite(record.exp)
  ) {
    return { ok: false, reason: 'malformed_claims' };
  }

  if (record.purpose !== RECOVERY_PROOF_PURPOSE) return { ok: false, reason: 'wrong_purpose' };
  if (record.exp <= Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' };
  if (!safeEqual(sig, sign(payload, secret))) return { ok: false, reason: 'invalid_signature' };
  if (!safeEqual(record.userId, expected.userId)) return { ok: false, reason: 'user_mismatch' };
  if (!safeEqual(record.sessionFingerprint, expected.sessionFingerprint)) return { ok: false, reason: 'session_mismatch' };

  return {
    ok: true,
    claims: {
      token: record.token,
      userId: record.userId,
      sessionFingerprint: record.sessionFingerprint,
      purpose: RECOVERY_PROOF_PURPOSE,
      exp: record.exp,
    },
  };
}

/**
 * Cheap structural check that a proof-shaped cookie is present. This is NOT
 * an authorization decision — signature, expiry, user and session binding
 * are all verified server-side by verifyRecoveryProof.
 */
export function isRecoveryProofPresent(cookies: {
  get(name: string): { value: string } | undefined;
}): boolean {
  const cookie = cookies.get(RECOVERY_PROOF_COOKIE);
  if (!cookie || cookie.value.length === 0) return false;
  const parts = cookie.value.split('.');
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}
