import {
  renderCompletionReceiptFromSnapshot,
  validateCanonicalAppOrigin,
  type CompletionReceiptRenderInput,
} from '../../../../lib/completionReceiptCore.ts';
import { mapE51ReceiptSnapshot } from '../receiptSnapshot.ts';
import type { CompletionReceiptMessage, CompletionReceiptTransport } from '../transportContract.ts';

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
  /** Optional renderer seam for deterministic test-only failure coverage. */
  render?: (input: CompletionReceiptRenderInput, appOrigin: string) => CompletionReceiptMessage;
  /** Optional safe stage codes for disposable tests; never contains row data. */
  onDiagnostic?: (code: CompletionReceiptWorkerDiagnostic) => void;
};

export type CompletionReceiptWorkerDiagnostic =
  | 'invalid_batch'
  | 'invalid_origin'
  | 'claim_rpc_rejected'
  | 'claim_response_schema_invalid'
  | 'claim_zero_eligible_rows'
  | 'invalid_claimed_row'
  | 'invalid_recipient'
  | 'snapshot_mapping_rejected'
  | 'rendering_rejected'
  | 'fake_transport_rejected'
  | 'ack_rpc_rejected'
  | 'ack_rejected'
  | 'fail_rpc_rejected'
  | 'fail_rejected'
  | 'fail_response_schema_invalid';

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

/** Accept only explicit-zone PostgreSQL/PostgREST timestamptz serializations. */
function validNextAttemptTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;

  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 15 || offsetMinute > 59) return false;
  }

  return Number.isFinite(Date.parse(value));
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

function diagnose(
  dependencies: CompletionReceiptWorkerEngineDependencies,
  code: CompletionReceiptWorkerDiagnostic,
): void {
  try {
    dependencies.onDiagnostic?.(code);
  } catch {
    // Diagnostics are observational and must never alter worker outcomes.
  }
}

function hasClaimResponseShape(rows: unknown): rows is ClaimedCompletionReceipt[] {
  return Array.isArray(rows) && rows.every((row) => row !== null && typeof row === 'object'
    && typeof row.out_id === 'string'
    && typeof row.out_order_id === 'string'
    && typeof row.out_recipient_email === 'string'
    && Object.hasOwn(row, 'out_receipt_snapshot')
    && Number.isSafeInteger(row.out_attempt_count)
    && typeof row.out_lease_token === 'string'
    && typeof row.out_lease_until === 'string');
}

type FailureRpcResponse = {
  out_status: 'pending' | 'dead_letter' | 'rejected';
  out_next_attempt_at: string | null;
};

function hasFailureRpcResponseShape(value: unknown): value is FailureRpcResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return (response.out_status === 'pending'
      || response.out_status === 'dead_letter'
      || response.out_status === 'rejected')
    && (response.out_status === 'rejected'
      ? response.out_next_attempt_at === null
      : validNextAttemptTimestamp(response.out_next_attempt_at));
}

async function recordFailure(
  dependencies: CompletionReceiptWorkerEngineDependencies,
  row: ClaimedCompletionReceipt,
  category: CompletionReceiptFailureCategory,
  summary: CompletionReceiptWorkerSummary,
): Promise<void> {
  try {
    const result: unknown = await dependencies.rpc.fail(row.out_id, row.out_lease_token, category);
    if (!hasFailureRpcResponseShape(result)) {
      diagnose(dependencies, 'fail_response_schema_invalid');
      summary.errors += 1;
      return;
    }
    if (result.out_status === 'rejected') {
      diagnose(dependencies, 'fail_rejected');
      summary.lostLeases += 1;
    } else if (result.out_status === 'pending') {
      summary.retryScheduled += 1;
    } else if (result.out_status === 'dead_letter') {
      summary.deadLettered += 1;
    } else {
      diagnose(dependencies, 'fail_response_schema_invalid');
      summary.errors += 1;
    }
  } catch {
    diagnose(dependencies, 'fail_rpc_rejected');
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
    diagnose(dependencies, 'invalid_batch');
    summary.errors = 1;
    return summary;
  }

  try {
    validateCanonicalAppOrigin(canonicalAppOrigin);
  } catch {
    diagnose(dependencies, 'invalid_origin');
    summary.errors = 1;
    return summary;
  }

  let rows: ClaimedCompletionReceipt[];
  try {
    const claimed = await dependencies.rpc.claim(requestedBatchSize, LEASE_SECONDS);
    if (!hasClaimResponseShape(claimed) || claimed.length > requestedBatchSize) {
      diagnose(dependencies, 'claim_response_schema_invalid');
      summary.errors = 1;
      return summary;
    }
    rows = claimed;
  } catch {
    diagnose(dependencies, 'claim_rpc_rejected');
    summary.errors = 1;
    return summary;
  }
  if (rows.length === 0) diagnose(dependencies, 'claim_zero_eligible_rows');
  summary.claimed = rows.length;

  // Sequential delivery keeps the lease window predictable and avoids an
  // unbounded fan-out. There is deliberately no lease-renewal path.
  for (const row of rows) {
    if (!row || typeof row.out_id !== 'string' || !UUID_PATTERN.test(row.out_id)
      || typeof row.out_lease_token !== 'string' || !UUID_PATTERN.test(row.out_lease_token)
      || !Number.isSafeInteger(row.out_attempt_count) || row.out_attempt_count < 1
      || row.out_attempt_count > 5) {
      diagnose(dependencies, 'invalid_claimed_row');
      summary.errors += 1;
      continue;
    }

    if (!validRecipient(row.out_recipient_email)) {
      diagnose(dependencies, 'invalid_recipient');
      await recordFailure(dependencies, row, 'INVALID_RECIPIENT', summary);
      continue;
    }

    let mapped;
    try {
      mapped = mapE51ReceiptSnapshot(row.out_receipt_snapshot, canonicalAppOrigin);
    } catch {
      diagnose(dependencies, 'snapshot_mapping_rejected');
      await recordFailure(dependencies, row, 'UNKNOWN', summary);
      continue;
    }

    let message: CompletionReceiptMessage;
    try {
      const rendered = (dependencies.render ?? renderCompletionReceiptFromSnapshot)(mapped.input, mapped.appOrigin);
      message = { ...rendered, recipient: row.out_recipient_email };
    } catch {
      diagnose(dependencies, 'rendering_rejected');
      await recordFailure(dependencies, row, 'UNKNOWN', summary);
      continue;
    }

    try {
      await dependencies.transport.send(message);
      summary.fakeDeliveries += 1;
    } catch (error) {
      diagnose(dependencies, 'fake_transport_rejected');
      const category = error instanceof FakeTransportFailure ? error.category : 'UNKNOWN';
      await recordFailure(dependencies, row, category, summary);
      continue;
    }

    try {
      if (await dependencies.rpc.acknowledge(row.out_id, row.out_lease_token, null)) {
        summary.acknowledged += 1;
      } else {
        diagnose(dependencies, 'ack_rejected');
        summary.lostLeases += 1;
      }
    } catch {
      diagnose(dependencies, 'ack_rpc_rejected');
      // Acknowledgment outcome is ambiguous; do not retry or call fail with a stale token.
      summary.errors += 1;
    }
  }

  return summary;
}
