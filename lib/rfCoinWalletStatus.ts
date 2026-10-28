export type RfCoinWalletStatus = 'ready' | 'disabled' | 'not_deployed' | 'not_configured' | 'incomplete';

/** A ready installed schema may show a customer's own ledger even while finance stays release-locked. */
export function shouldLoadRfCoinLedger(infrastructureReady: boolean, status: RfCoinWalletStatus | undefined): boolean {
  return infrastructureReady && status === 'ready';
}
