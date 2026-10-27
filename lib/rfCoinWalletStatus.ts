export type RfCoinWalletStatus = 'ready' | 'disabled' | 'not_deployed' | 'not_configured' | 'incomplete';

/** Only a fully enabled wallet may request its transaction ledger. */
export function shouldLoadRfCoinLedger(enabled: boolean, status: RfCoinWalletStatus | undefined): boolean {
  return enabled && status === 'ready';
}
