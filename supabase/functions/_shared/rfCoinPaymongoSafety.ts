export type RfCoinPaymongoConfig = {
  providerName: unknown;
  providerType: unknown;
  enabled: unknown;
  testMode: unknown;
  secretKey: string | null | undefined;
  apiUrl: string | null | undefined;
};

/**
 * RF Coins funding is intentionally sandbox-only until the hosted wallet,
 * webhook, and ledger acceptance gates are complete. The provider's test
 * switch alone is insufficient: require a PayMongo test credential too.
 */
export function isSafeRfCoinPaymongoSandbox(config: RfCoinPaymongoConfig): boolean {
  if (config.providerName !== 'paymongo'
    || config.providerType !== 'automated'
    || config.enabled !== true
    || config.testMode !== true
    || !config.secretKey?.startsWith('sk_test_')) {
    return false;
  }

  const apiUrl = config.apiUrl || 'https://api.paymongo.com/v1';
  try {
    const parsed = new URL(apiUrl);
    return parsed.protocol === 'https:'
      && parsed.hostname === 'api.paymongo.com'
      && parsed.port === ''
      && parsed.username === ''
      && parsed.password === ''
      && parsed.pathname.replace(/\/$/, '') === '/v1'
      && parsed.search === ''
      && parsed.hash === '';
  } catch {
    return false;
  }
}
