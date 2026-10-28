export type CustomerWalletSummaryState =
  | { kind: 'anonymous' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'ready'; balance: number; canAddFunds: boolean };

type WalletPayload = {
  wallet?: { balance_coins?: unknown } | null;
  walletStatus?: string;
  enabled?: boolean;
  topupsEnabled?: boolean;
  packages?: unknown[];
};

const unavailableMessages: Record<string, string> = {
  not_deployed: 'Wallet setup is not available in this environment yet.',
  not_configured: 'The wallet is not configured in this environment.',
  disabled: 'RF Coins is currently disabled.',
  incomplete: 'Wallet setup is incomplete. No balance is available.',
};

/** Accept a balance only when the authenticated API returns a real wallet row. */
export function resolveCustomerWalletSummary(
  httpStatus: number,
  value: unknown,
): CustomerWalletSummaryState {
  if (httpStatus === 401) return { kind: 'anonymous' };
  if (httpStatus !== 200 || !value || typeof value !== 'object') {
    return { kind: 'unavailable', message: 'Wallet unavailable. Please try again later.' };
  }

  const payload = value as WalletPayload;
  const walletStatus = typeof payload.walletStatus === 'string' ? payload.walletStatus : '';
  if (walletStatus !== 'ready' || payload.enabled !== true || !payload.wallet || typeof payload.wallet !== 'object') {
    return {
      kind: 'unavailable',
      message: unavailableMessages[walletStatus] || 'Wallet unavailable. No balance is being presented as active.',
    };
  }

  const balance = payload.wallet.balance_coins;
  if (typeof balance !== 'number' || !Number.isSafeInteger(balance) || balance < 0) {
    return { kind: 'unavailable', message: 'Wallet balance is unavailable. No balance is being presented as active.' };
  }

  return {
    kind: 'ready',
    balance,
    canAddFunds: payload.topupsEnabled === true && Array.isArray(payload.packages) && payload.packages.length > 0,
  };
}
