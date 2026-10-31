export type CampaignType =
  | 'WELCOME'
  | 'SEASONAL'
  | 'GAME_SPECIFIC'
  | 'PACKAGE_SPECIFIC'
  | 'LIMITED_REDEMPTION'
  | 'CUSTOMER_RETENTION'
  | 'PUBLIC_PROMOTION'
  | 'PRIVATE_CODE';

export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'ARCHIVED';

export function normalizeCampaignCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidCampaignCode(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{2,39}$/.test(normalizeCampaignCode(value));
}

/** Parse currency without binary floating-point rounding. Values are PHP. */
export function parseMoneyCents(value: string): number | null {
  const normalized = value.trim().replace(/^₱/, '');
  if (!/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function zonedParts(date: Date, timezone: string): Record<string, number> | null {
  try {
    const values = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const parts: Record<string, number> = {};
    for (const part of values) {
      if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    return parts;
  } catch {
    return null;
  }
}

/**
 * Convert a datetime-local value interpreted in an explicit IANA timezone to
 * an ISO UTC instant. Nonexistent DST wall times are rejected, never guessed.
 */
export function zonedDateTimeToIso(value: string, timezone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const wanted = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] || 0),
  };
  if (wanted.month < 1 || wanted.month > 12 || wanted.day < 1 || wanted.day > 31
      || wanted.hour > 23 || wanted.minute > 59 || wanted.second > 59) return null;
  const wantedEpoch = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute, wanted.second);
  const calendar = new Date(wantedEpoch);
  if (calendar.getUTCFullYear() !== wanted.year || calendar.getUTCMonth() + 1 !== wanted.month
      || calendar.getUTCDate() !== wanted.day) return null;

  let candidate = wantedEpoch;
  for (let i = 0; i < 5; i += 1) {
    const shown = zonedParts(new Date(candidate), timezone);
    if (!shown) return null;
    const shownEpoch = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
    const delta = wantedEpoch - shownEpoch;
    if (delta === 0) return new Date(candidate).toISOString();
    candidate += delta;
  }
  return null;
}

export function isoToZonedDateTimeInput(value: string, timezone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = zonedParts(date, timezone);
  if (!parts) return '';
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function formatCampaignDate(value: string | null, timezone: string): string {
  if (!value) return 'No end date';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Invalid date';
  try {
    return new Intl.DateTimeFormat('en-PH', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: timezone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
  }
}

export function computeCampaignDiscount(
  subtotalCents: number,
  type: 'PERCENTAGE' | 'FIXED',
  value: number,
  maximumCents: number | null,
): { discountCents: number; totalCents: number } | null {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 0
      || !Number.isSafeInteger(value) || value <= 0
      || (type === 'PERCENTAGE' && value > 100)
      || (maximumCents !== null && (!Number.isSafeInteger(maximumCents) || maximumCents <= 0))) return null;
  let discount = type === 'PERCENTAGE' ? Math.round((subtotalCents * value) / 100) : value;
  if (maximumCents !== null) discount = Math.min(discount, maximumCents);
  discount = Math.min(subtotalCents, discount);
  const total = subtotalCents - discount;
  if (discount <= 0 || total <= 0) return null;
  return { discountCents: discount, totalCents: total };
}
