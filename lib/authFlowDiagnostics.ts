type ErrorMetadata = { status?: unknown };

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const value = (error as ErrorMetadata).status;
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599
    ? value
    : undefined;
}

/**
 * Emit stage-only authentication diagnostics. Never serialize the provider
 * error itself: Auth errors can contain an email, token, or request detail.
 */
export function logAuthFlowFailure(flow: string, stage: string, error?: unknown): void {
  const status = httpStatus(error);
  const category = status === 429
    ? 'rate_limited'
    : status && status >= 500
      ? 'upstream_unavailable'
      : status && status >= 400
        ? 'upstream_rejected'
        : error
          ? 'provider_error'
          : 'internal_failure';

  console.warn('auth_flow_failure', {
    flow,
    stage,
    category,
    timestamp_utc: new Date().toISOString(),
    ...(status ? { http_status: status } : {}),
  });
}
