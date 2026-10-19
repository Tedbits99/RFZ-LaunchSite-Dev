import { createHmac } from 'node:crypto';

import { normalizeOrderEmail } from '@/lib/orderAccess';

/** Dedicated server-only secret used for opaque confirmation-resend keys. */
export const CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET_ENV =
  'RFZ_CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET';

export type ConfirmationResendKeyPurpose = 'email' | 'network';

const MIN_SECRET_BYTES = 32;
const MAX_IDENTIFIER_LENGTH = 512;

function getSecret(): string {
  if (typeof window !== 'undefined') {
    throw new Error('Confirmation resend key derivation is server-only.');
  }

  const secret = process.env[CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET_ENV];
  if (!secret || Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    throw new Error('Confirmation resend key secret is unavailable.');
  }

  return secret;
}

function normalizeIdentifier(purpose: ConfirmationResendKeyPurpose, identifier: unknown): string {
  const value = purpose === 'email' ? normalizeOrderEmail(identifier) : identifier;

  if (typeof value !== 'string' || !value || !value.trim() || value.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error('Confirmation resend identifier is invalid.');
  }

  if (purpose === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('Confirmation resend identifier is invalid.');
  }

  if (/^[\u0000-\u001f\u007f]|[\u0000-\u001f\u007f]$/.test(value)) {
    throw new Error('Confirmation resend identifier is invalid.');
  }

  return value;
}

/**
 * Derive the opaque lowercase hexadecimal key accepted by the resend limiter.
 * The network identifier must already have been verified by the caller; this
 * helper deliberately does not inspect forwarding headers or infer client IPs.
 */
export function deriveCustomerConfirmationResendKey(
  purpose: ConfirmationResendKeyPurpose,
  identifier: unknown,
): string {
  const secret = getSecret();
  const normalizedIdentifier = normalizeIdentifier(purpose, identifier);
  const message = `runfazone/customer-confirmation-resend/${purpose}:${normalizedIdentifier}`;

  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}
