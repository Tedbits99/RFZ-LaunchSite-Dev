export const RF_COIN_ERROR_MESSAGES: Record<string, string> = {
  RF_COIN_DISABLED: 'RF Coins is not available right now.',
  RF_COIN_TOPUPS_DISABLED: 'Buying RF Coins is temporarily unavailable.',
  RF_COIN_SPENDING_DISABLED: 'Paying with RF Coins is temporarily unavailable.',
  RF_COIN_FUNDING_RELEASE_LOCKED: 'Wallet funding is awaiting financial release approval.',
  RF_COIN_SPENDING_RELEASE_LOCKED: 'RF Coins spending is not available in this release.',
  RF_COIN_FORBIDDEN: 'You are not allowed to perform this action.',
  RF_COIN_PACKAGE_UNAVAILABLE: 'That coin package is no longer available.',
  RF_COIN_TOPUP_NOT_FOUND: 'Top-up not found.',
  RF_COIN_TOPUP_NOT_PENDING: 'This top-up can no longer be credited.',
  RF_COIN_ORDER_NOT_FOUND: 'Order not found.',
  RF_COIN_INSUFFICIENT_BALANCE: 'Not enough RF Coins in your wallet.',
  RF_COIN_INVALID_REQUEST: 'Invalid adjustment request.',
  RF_COIN_IDEMPOTENCY_CONFLICT: 'This adjustment retry key was already used for a different request.',
  RF_COIN_RATE_LIMITED: 'Daily adjustment limit reached. Please try again tomorrow.',
  RF_COIN_SECOND_ADMIN_REQUIRED: 'A second Super Admin must approve this request.',
  RF_COIN_ALREADY_APPROVED: 'This request was already approved by another admin.',
  RF_COIN_REQUEST_NOT_FOUND: 'Adjustment request not found.',
  RF_COIN_REQUEST_NOT_PENDING: 'This request is no longer pending.',
  RF_COIN_NO_ORDER_PAYMENT: 'No wallet payment found for this order.',
  RF_COIN_ORDER_NOT_WAITING: 'This order is not awaiting payment.',
  RF_COIN_INVALID_STATUS: 'Invalid top-up status.',
  RF_COIN_LEDGER_IMMUTABLE: 'Ledger entries cannot be changed.',
  RF_COIN_AUDIT_IMMUTABLE: 'Audit entries cannot be changed.',
  RF_COIN_INVALID_PACKAGE: 'Invalid package.',
  RF_COIN_PACKAGE_NOT_FOUND: 'Package not found.',
};

export function rfCoinErrorMessage(code: string | null | undefined, fallback: string): string {
  if (!code) return fallback;
  return RF_COIN_ERROR_MESSAGES[code] ?? fallback;
}

export function formatCoins(coins: number): string {
  return coins.toLocaleString('en-PH');
}

export function formatCoinPrice(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

export function coinsForCents(totalCents: number, centavosPerCoin: number): number {
  return Math.ceil(totalCents / centavosPerCoin);
}

export const RF_COIN_PAYMENT_METHOD = 'rf_coin_wallet';

export type RfCoinTopupStatus =
  | 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'REFUND_PENDING' | 'REFUNDED';

export type RfCoinPackage = {
  id: string;
  name: string;
  coins: number;
  bonus_coins: number;
  price_cents: number;
  is_active: boolean;
  sort_order: number;
};

export type RfCoinWallet = {
  user_id: string;
  balance_coins: number;
  total_purchased_coins: number;
  total_spent_coins: number;
  total_manual_credited_coins: number;
  total_manual_debited_coins: number;
  total_reversed_coins: number;
};

export type RfCoinLedgerEntry = {
  id: string;
  direction: 'credit' | 'debit';
  amount_coins: number;
  kind: string;
  balance_after: number;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
};

export type RfCoinTopup = {
  id: string;
  user_id: string;
  package_id: string | null;
  coins: number;
  bonus_coins: number;
  price_cents: number;
  status: RfCoinTopupStatus;
  provider_reference: string | null;
  credited_at: string | null;
  created_at: string;
};
