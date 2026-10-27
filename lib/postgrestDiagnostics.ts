type PostgrestErrorMetadata = { code?: unknown; status?: unknown };

/** Log only safe PostgREST identifiers; never serialize messages or row data. */
export function logPostgrestQueryFailure(surface: string, error: unknown): void {
  const details = error && typeof error === 'object' ? error as PostgrestErrorMetadata : {};
  const code = typeof details.code === 'string' && /^[A-Za-z0-9_-]{3,16}$/.test(details.code)
    ? details.code
    : undefined;
  const status = typeof details.status === 'number' && Number.isInteger(details.status)
    && details.status >= 400 && details.status <= 599
    ? details.status
    : undefined;

  console.error('postgrest_query_failure', {
    surface,
    timestamp_utc: new Date().toISOString(),
    ...(code ? { code } : {}),
    ...(status ? { http_status: status } : {}),
  });
}
