/**
 * Server-to-server authorization for the transactional email Edge Function.
 *
 * The value is deliberately compared as an opaque bearer secret. It is never
 * derived from a caller-supplied role claim or email payload field.
 */
export function hasAuthorizedTransactionalEmailRequest(
  request: Pick<Request, 'headers'>,
  serviceRoleKey: string,
): boolean {
  if (!serviceRoleKey) return false;
  return request.headers.get('authorization') === `Bearer ${serviceRoleKey}`;
}
