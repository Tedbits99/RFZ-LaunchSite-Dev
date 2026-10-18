import type { CompletionReceipt } from '../../../lib/completionReceiptCore.ts';

/** Contract only: E5.3A deliberately provides no concrete or network transport. */
export type CompletionReceiptMessage = CompletionReceipt & {
  recipient: string;
};

/** Future transport implementations must be injected; delivery is not exactly-once. */
export interface CompletionReceiptTransport {
  send(message: CompletionReceiptMessage): Promise<void>;
}
