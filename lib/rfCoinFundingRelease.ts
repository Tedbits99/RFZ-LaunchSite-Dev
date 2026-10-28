/**
 * RF Coins funding remains release-locked until the direct-wallet funding
 * design, signed verification, idempotent credit/refund handling, and hosted
 * acceptance gates have all been approved. This is deliberately not an
 * environment-controlled switch: a database flag or deployment variable must
 * not accidentally enable financial operations.
 */
export const RF_COINS_FUNDING_RELEASE_ENABLED = false;
