import {
  validateCanonicalAppOrigin,
  type CompletionReceiptRenderInput,
} from '../_shared/completionReceiptCore.ts';

const E51_FIELDS = [
  'reference',
  'total_cents',
  'payment_method',
  'game_name',
  'package_name',
  'quantity',
  'masked_player_identifier',
  'completed_at',
] as const;

function requiredText(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 320
    && !/[\u0000-\u001f\u007f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/.test(value);
}

/** PostgreSQL to_jsonb(timestamptz) emits an ISO timestamp with an explicit zone. */
function isE51Timestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;

  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 15 || offsetMinute > 59) return false;
  }

  return Number.isFinite(Date.parse(value));
}

/** Maps only the authoritative E5.1 snapshot; this module never fetches order/player data. */
export function mapE51ReceiptSnapshot(
  snapshot: unknown,
  configuredOrigin: unknown,
): { input: CompletionReceiptRenderInput; appOrigin: string } {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Invalid authoritative receipt snapshot.');
  }

  const record = snapshot as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== E51_FIELDS.length || E51_FIELDS.some((field) => !Object.hasOwn(record, field))) {
    throw new Error('Invalid authoritative receipt snapshot.');
  }

  if (!requiredText(record.reference)
    || !/^RF-[A-Z0-9-]+$/i.test(record.reference)
    || !requiredText(record.payment_method)
    || !requiredText(record.game_name)
    || !requiredText(record.package_name)
    || !requiredText(record.masked_player_identifier)
    || !/^\*+(?:[^\u0000-\u001f\u007f]{4})?$/.test(record.masked_player_identifier)
    || typeof record.total_cents !== 'number'
    || !Number.isSafeInteger(record.total_cents)
    || record.total_cents < 1
    || typeof record.quantity !== 'number'
    || !Number.isSafeInteger(record.quantity)
    || record.quantity < 1
    || record.quantity > 1_000_000
    || !requiredText(record.completed_at)
    || !isE51Timestamp(record.completed_at)) {
    throw new Error('Invalid authoritative receipt snapshot.');
  }

  const appOrigin = validateCanonicalAppOrigin(configuredOrigin);
  return {
    appOrigin,
    input: {
      publicOrderReference: record.reference,
      totalCents: record.total_cents,
      paymentMethod: record.payment_method,
      gameName: record.game_name,
      packageName: record.package_name,
      quantity: record.quantity,
      maskedPlayerIdentifier: record.masked_player_identifier,
      completedAt: record.completed_at,
    },
  };
}
