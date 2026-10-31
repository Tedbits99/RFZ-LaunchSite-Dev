export type TopupStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'REFUND_PENDING' | 'REFUNDED';

export const TOPUP_STATUS_COPY: Record<TopupStatus, { title: string; message: string; tone: string }> = {
  PENDING: { title: 'Payment pending', message: 'Scan this QR code. RF Coins are added only after the signed payment webhook confirms the payment.', tone: 'text-amber-200' },
  PAID: { title: 'Payment confirmed', message: 'Your RF Coins have been credited to your wallet.', tone: 'text-emerald-300' },
  FAILED: { title: 'Payment failed', message: 'No wallet credit was applied. You can close this notice and try again later.', tone: 'text-rose-300' },
  EXPIRED: { title: 'Payment expired', message: 'This QR payment expired. No wallet credit was applied.', tone: 'text-slate-300' },
  CANCELLED: { title: 'Payment cancelled', message: 'This top-up was cancelled. No wallet credit was applied.', tone: 'text-slate-300' },
  REFUND_PENDING: { title: 'Refund under review', message: 'The payment was referred for safe wallet reconciliation. No additional credit is applied automatically.', tone: 'text-amber-200' },
  REFUNDED: { title: 'Payment refunded', message: 'This top-up has been refunded and its wallet ledger reversal is recorded.', tone: 'text-cyan-200' },
};

export function isTopupStatus(value: unknown): value is TopupStatus {
  return typeof value === 'string' && Object.hasOwn(TOPUP_STATUS_COPY, value);
}
