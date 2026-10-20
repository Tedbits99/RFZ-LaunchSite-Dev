import { getConfiguredAppOrigin } from '@/lib/authRedirect';
import {
  normalizeRawPlayerIdentifier,
  renderCompletionReceiptFromSnapshot,
  type CompletionReceipt,
  type CompletionReceiptRenderInput,
} from './completionReceiptCore';

export type { CompletionReceipt } from './completionReceiptCore';

/** Backwards-compatible Next.js input. This API accepts raw IDs only at its existing server-side boundary. */
export type CompletionReceiptInput = Omit<CompletionReceiptRenderInput, 'maskedPlayerIdentifier'> & {
  playerIdentifier: string;
};

function maskPlayerIdentifier(identifier: string): string {
  if (identifier.length <= 4) return '*'.repeat(identifier.length);
  return `${'*'.repeat(identifier.length - 4)}${identifier.slice(-4)}`;
}

function assertServer(): void {
  if (typeof window !== 'undefined') {
    throw new Error('Completion receipt rendering is server-only.');
  }
}

/** Preserve the existing Next.js API; the Deno worker imports only the pure core module. */
export function renderCompletionReceipt(input: CompletionReceiptInput): CompletionReceipt {
  assertServer();
  const origin = getConfiguredAppOrigin();
  if (!origin) throw new Error('Completion receipt application origin is unavailable.');

  const { playerIdentifier, ...receipt } = input;
  const normalizedPlayerIdentifier = normalizeRawPlayerIdentifier(playerIdentifier);
  return renderCompletionReceiptFromSnapshot({
    ...receipt,
    maskedPlayerIdentifier: maskPlayerIdentifier(normalizedPlayerIdentifier),
  }, origin, true);
}
