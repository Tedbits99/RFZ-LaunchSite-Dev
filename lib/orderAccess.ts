/**
 * Normalize an order ownership email before it is used in a database filter.
 * Rejecting non-string and empty values keeps missing ownership proof fail-closed.
 */
export function normalizeOrderEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length > 0 && email.length <= 320 ? email : null;
}

export function isOrderOwner(requestedEmail: unknown, orderEmail: unknown): boolean {
  const requested = normalizeOrderEmail(requestedEmail);
  const owner = normalizeOrderEmail(orderEmail);
  return requested !== null && owner !== null && requested === owner;
}
