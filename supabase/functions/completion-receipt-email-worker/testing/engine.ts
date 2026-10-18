import {
  renderCompletionReceiptFromSnapshot,
  validateCanonicalAppOrigin,
} from '../../../../lib/completionReceiptCore.ts';
import { mapE51ReceiptSnapshot } from '../receiptSnapshot.ts';
import type { CompletionReceiptTransport } from '../transportContract.ts';

export type ClaimedCompletionReceipt = {
  out_id: string;
  out_order_id: string;
  out_recipient_email: string;
  out_receipt_snapshot: unknown;
  out_attempt_count: number;
  out_lease_token: string;
  out_lease_until: string;
};

export type CompletionReceiptFailureCategory =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RECIPIENT'
  | 'PROVIDER_REJECTED'
  | 'UNKNOWN';

export type CompletionReceiptWorkerRpc = {
  claim(limit: number, leaseSeconds: number): Promise<ClaimedCompletionReceipt[]>;
  acknowledge(id: string, leaseToken: string, providerMessageId?: string | null): Promise<boolean>;
  fail(
    id: string,
    leaseToken: string,
    category: CompletionReceiptFailureCategory,
  ): Promise<{ out_status: string; out_next_attempt_at: string | null }>;
};

export type CompletionReceiptWorkerEngineDependencies = {
  rpc: CompletionReceiptWorkerRpc;
  transport: CompletionReceiptTransport;
};

export type CompletionReceiptWorkerSummary = {
  claimed: number;
  fakeDeliveries: number;
  acknowledged: number;
  retryScheduled: number;
  deadLettered: number;
  lostLeases: number;
  errors: number;
};

const MAX_BATCH_SIZE = 5;
const LEASE_SECONDS = 300;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A test-only typed error; arbitrary error messages are never inspected or persisted. */
export class FakeTransportFailure extends Error {
  constructor(readonly category: CompletionReceiptFailureCategory) {
    super('Fake transport failure');
    this.name = 'FakeTransportFailure';
  }
}

function validRecipient(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function blankSummary(): CompletionReceiptWorkerSummary {
  return {
    claimed: 0,
    fakeDeliveries: 0,
    acknowledged: 0,
    retryScheduled: 0,
    deadLettered: 0,
    lostLeases: 0,
    errors: 0,
  };
}

async function recordFailure(
  dependencies: CompletionReceiptWorkerEngineDependencies,
  row: ClaimedCompletionReceipt,
  category: CompletionReceiptFailureCategory,
  summary: CompletionReceiptWorkerSummary,
): Promise<void> {
  try {
    const result = await dependencies.rpc.fail(row.out_id, row.out_lease_token, category);
    if (result.out_status === 'rejected') {
      summary.lostLeases += 1;
    } else if (result.out_status === 'pending') {
      summary.retryScheduled += 1;
    } else if (result.out_status === 'dead_letter') {
      summary.deadLettered += 1;
    } else {
      summary.errors += 1;
    }
  } catch {
    // The RPC may have committed despite a lost response. Never retry or repair here.
    summary.errors += 1;
  }
}

/**
 * Isolated orchestration engine for tests only. The deployed index/handler do
 * not import this module. All I/O is injected and must be disposable/fake-only.
 */
export async function runCompletionReceiptWorkerEngine(
  dependencies: CompletionReceiptWorkerEngineDependencies,
  canonicalAppOrigin: string,
  requestedBatchSize = MAX_BATCH_SIZE,
): Promise<CompletionReceiptWorkerSummary> {
  const summary = blankSummary();
  if (!Number.isInteger(requestedBatchSize) || requestedBatchSize < 1 || requestedBatchSize > MAX_BATCH_SIZE) {
    summary.errors = 1;
    return summary;
  }

  try {
    validateCanonicalAppOrigin(canonicalAppOrigin);
  } catch {
    summary.errors = 1;
    return summary;
  }

  let rows: ClaimedCompletionReceipt[];
  try {
    rows = await dependencies.rpc.claim(requestedBatchSize, LEASE_SECONDS);
    if (!Array.isArray(rows) || rows.length > requestedBatchSize) {
      summary.errors = 1;
      return summary;
    }
  } catch {
    summary.errors = 1;
    return summary;
  }
  summary.claimed = rows.length;

  // Sequential delivery keeps the lease window predictable and avoids an
  // unbounded fan-out. There is deliberately no lease-renewal path.
  for (const row of rows) {
    if (!row || typeof row.out_id !== 'string' || !UUID_PATTERN.test(row.out_id)
      || typeof row.out_lease_token !== 'string' || !UUID_PATTERN.test(row.out_lease_token)
      || !Number.isSafeInteger(row.out_attempt_count) || row.out_attempt_count < 1
      || row.out_attempt_count > 5) {
      summary.errors += 1;
      continue;
    }

    if (!validRecipient(row.out_recipient_email)) {
      await recordFailure(dependencies, row, 'INVALID_RECIPIENT', summary);
      continue;
    }

    let message;
    try {
      const mapped = mapE51ReceiptSnapshot(row.out_receipt_snapshot, canonicalAppOrigin);
      const rendered = renderCompletionReceiptFromSnapshot(mapped.input, mapped.appOrigin);
      message = { ...rendered, recipient: row.out_recipient_email };
    } catch {
      await recordFailure(dependencies, row, 'UNKNOWN', summary);
      continue;
    }

    try {
      await dependencies.transport.send(message);
      summary.fakeDeliveries += 1;
    } catch (error) {
      const category = error instanceof FakeTransportFailure ? error.category : 'UNKNOWN';
      await recordFailure(dependencies, row, category, summary);
      continue;
    }

    try {
      if (await dependencies.rpc.acknowledge(row.out_id, row.out_lease_token, null)) {
        summary.acknowledged += 1;
      } else {
        summary.lostLeases += 1;
      }
    } catch {
      // Acknowledgment outcome is ambiguous; do not retry or call fail with a stale token.
      summary.errors += 1;
    }
  }

  return summary;
}
