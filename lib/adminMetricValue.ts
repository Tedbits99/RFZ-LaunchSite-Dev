/** Do not turn a failed dashboard query into a misleading numeric zero. */
export function adminMetricValue<T extends string | number>(value: T, queryFailed: boolean): T | '—' {
  return queryFailed ? '—' : value;
}
