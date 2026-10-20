import { renderCompletionReceiptFromSnapshot, validateCanonicalAppOrigin } from '../_shared/completionReceiptCore.ts';
import { mapE51ReceiptSnapshot } from './receiptSnapshot.ts';
import type { CompletionReceiptMessage } from './transportContract.ts';

type Claim = {
  out_id: string;
  out_recipient_email: string;
  out_receipt_snapshot: unknown;
  out_lease_token: string;
  out_lease_until: string;
};
export interface ReceiptRpc {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export type ReceiptFailureCategory = 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'INVALID_RECIPIENT' | 'PROVIDER_REJECTED';

/**
 * A transport may throw this only when it can prove the provider did not accept
 * the message. Ambiguous network failures must remain untyped so the lease is
 * retained until expiry and recovery uses the same idempotency key.
 */
export class ReceiptNotDeliveredError extends Error {
  constructor(readonly category: ReceiptFailureCategory) {
    super('Receipt was not accepted for delivery.');
    this.name = 'ReceiptNotDeliveredError';
  }
}

export interface IdempotentReceiptTransport {
  send(message: CompletionReceiptMessage, idempotencyKey: string): Promise<void>;
}

/** Injected transport only. The deployed entry point does not enable delivery. */
export async function processReceiptBatch(db: ReceiptRpc, transport: IdempotentReceiptTransport, origin: string, now = Date.now) {
  validateCanonicalAppOrigin(origin);
  const claimed = await db.rpc('claim_completion_receipt_outbox', { p_limit: 10, p_lease_seconds: 300 });
  if (claimed.error || !Array.isArray(claimed.data)) throw new Error('Receipt claim unavailable.');
  const result = { sent: 0, retryScheduled: 0, deadLetter: 0, unknown: 0, rejected: 0 };
  for (const row of claimed.data as Claim[]) {
    const lease = Date.parse(row.out_lease_until);
    if (!row.out_id || !row.out_lease_token || !Number.isFinite(lease) || lease <= now()) {
      result.rejected++;
      continue;
    }
    const args = { p_id: row.out_id, p_lease_token: row.out_lease_token };
    let message: CompletionReceiptMessage;
    try {
      if (typeof row.out_recipient_email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.out_recipient_email)) throw new Error('Invalid recipient');
      const mapped = mapE51ReceiptSnapshot(row.out_receipt_snapshot, origin);
      message = { ...renderCompletionReceiptFromSnapshot(mapped.input, mapped.appOrigin), recipient: row.out_recipient_email };
    } catch {
      const failure = await Promise.resolve(db.rpc('fail_completion_receipt_outbox', { ...args, p_error: 'PROVIDER_REJECTED' })).catch(() => ({ error: true, data: null }));
      recordFailure(failure, result);
      continue;
    }
    try {
      // A stable outbox ID survives lease rotation and ack failure. The provider
      // must honor this key; without that contract delivery is at-least-once.
      await transport.send(message, `completion-receipt:${row.out_id}`);
    } catch (error) {
      if (error instanceof ReceiptNotDeliveredError) {
        const failure = await Promise.resolve(db.rpc('fail_completion_receipt_outbox', {
          ...args,
          p_error: error.category,
        })).catch(() => ({ error: true, data: null }));
        recordFailure(failure, result);
      } else {
        // A timeout may have delivered mail. Keep the lease for recovery and
        // reuse the stable idempotency key after it expires.
        result.unknown++;
      }
      continue;
    }
    try {
      const ack = await db.rpc('ack_completion_receipt_sent', { ...args, p_provider_message_id: null });
      if (!ack.error && ack.data === true) result.sent++;
      else result.unknown++;
    } catch { result.unknown++; }
  }
  return result;
}

function recordFailure(failure: { data: unknown; error: unknown }, result: { retryScheduled: number; deadLetter: number; unknown: number; rejected: number }) {
  const rows = failure.data as { out_status?: string }[] | null;
  const status = Array.isArray(rows) ? rows[0]?.out_status : undefined;
  if (failure.error) result.unknown++;
  else if (status === 'pending') result.retryScheduled++;
  else if (status === 'dead_letter') result.deadLetter++;
  else result.rejected++;
}
