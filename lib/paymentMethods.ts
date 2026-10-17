export const PAYMENT_METHODS = [
  { key: 'gcash', name: 'GCash', detail: 'Pay with GCash', className: 'from-[#1262c5] to-[#0d3e91]' },
  { key: 'maya', name: 'Maya', detail: 'Pay with Maya', className: 'from-[#0b8f68] to-[#056245]' },
  { key: 'coinsph', name: 'Coins.ph', detail: 'Pay with Coins.ph', className: 'from-[#ea9f2d] to-[#b85b13]' },
  { key: 'paymongo_qrph', name: 'QR Ph', detail: 'Scan & pay with QR Ph', className: 'from-[#0d7a5f] to-[#075c47]' },
] as const;

export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]['key'];

export function paymentMethodLabel(key: string | null | undefined): string {
  if (!key) return '—';
  return PAYMENT_METHODS.find((method) => method.key === key)?.name ?? key;
}
