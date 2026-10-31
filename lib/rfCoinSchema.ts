type DatabaseError = { code?: string | null; message?: string | null } | null | undefined;

/** Recognize only a missing RF Coins relation, not arbitrary database errors. */
export function isMissingRfCoinTable(error: DatabaseError, tableName: string): boolean {
  if (!error || (error.code !== 'PGRST205' && error.code !== '42P01')) return false;
  const message = error.message || '';
  return message.includes(tableName) && /table|relation|schema cache/i.test(message);
}
