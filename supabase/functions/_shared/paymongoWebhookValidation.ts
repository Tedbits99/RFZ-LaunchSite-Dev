export interface PayMongoPaymentSnapshot {
  amountCents: number | null;
  currency: string | null;
}

export function extractPayMongoProviderReference(
  eventType: string,
  resourceId: unknown,
  attributes: unknown,
): string | null {
  if (typeof resourceId !== "string" || !resourceId) return null;
  // Checkout-session payment events are correlated to the checkout session;
  // payment.paid events should use the parent intent when PayMongo provides it.
  if (eventType.includes("checkout_session")) return resourceId;
  if (!attributes || typeof attributes !== "object") return resourceId;

  const attrs = attributes as Record<string, unknown>;
  const nestedPayments = Array.isArray(attrs.payments) ? attrs.payments : [];
  const nestedAttributes = nestedPayments[0] && typeof nestedPayments[0] === "object"
    ? ((nestedPayments[0] as Record<string, unknown>).attributes as Record<string, unknown> | undefined)
    : undefined;
  const paymentIntent = attrs.payment_intent && typeof attrs.payment_intent === "object"
    ? (attrs.payment_intent as Record<string, unknown>).id
    : null;
  const nestedIntent = nestedAttributes?.payment_intent && typeof nestedAttributes.payment_intent === "object"
    ? (nestedAttributes.payment_intent as Record<string, unknown>).id
    : null;
  const reference = attrs.payment_intent_id ?? paymentIntent ?? nestedAttributes?.payment_intent_id ?? nestedIntent;
  return typeof reference === "string" && reference ? reference : resourceId;
}

/**
 * PayMongo payment.paid events carry amount/currency on the payment resource;
 * checkout_session.payment.paid events may carry them on the nested payment.
 * Missing or malformed values intentionally remain null so callers fail closed.
 */
export function extractPayMongoPaymentSnapshot(attributes: unknown): PayMongoPaymentSnapshot {
  if (!attributes || typeof attributes !== "object") {
    return { amountCents: null, currency: null };
  }

  const attrs = attributes as Record<string, unknown>;
  const nestedPayments = Array.isArray(attrs.payments) ? attrs.payments : [];
  const nestedAttributes = nestedPayments[0] && typeof nestedPayments[0] === "object"
    ? ((nestedPayments[0] as Record<string, unknown>).attributes as Record<string, unknown> | undefined)
    : undefined;

  const rawAmount = typeof attrs.amount === "number" ? attrs.amount : nestedAttributes?.amount;
  const amountCents = typeof rawAmount === "number" && Number.isSafeInteger(rawAmount) && rawAmount >= 0
    ? rawAmount
    : null;
  const rawCurrency = typeof attrs.currency === "string" ? attrs.currency : nestedAttributes?.currency;
  const currency = typeof rawCurrency === "string" && /^[A-Za-z]{3}$/.test(rawCurrency.trim())
    ? rawCurrency.trim().toUpperCase()
    : null;

  return { amountCents, currency };
}

/** A paid event is acceptable only when both provider values match the persisted checkout snapshot. */
export function payMongoPaymentMatchesSnapshot(
  event: PayMongoPaymentSnapshot,
  expectedAmountCents: unknown,
  expectedCurrency: unknown,
): boolean {
  if (
    event.amountCents === null ||
    event.currency === null ||
    typeof expectedAmountCents !== "number" ||
    !Number.isSafeInteger(expectedAmountCents) ||
    typeof expectedCurrency !== "string" ||
    !/^[A-Za-z]{3}$/.test(expectedCurrency.trim())
  ) {
    return false;
  }

  return event.amountCents === expectedAmountCents && event.currency === expectedCurrency.trim().toUpperCase();
}
