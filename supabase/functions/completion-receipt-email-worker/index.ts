import { createCompletionReceiptWorkerHandler } from './handler.ts';

const handler = createCompletionReceiptWorkerHandler({
  enabled: Deno.env.get('COMPLETION_RECEIPT_WORKER_ENABLED') ?? null,
  invocationSecret: Deno.env.get('COMPLETION_RECEIPT_WORKER_SECRET') ?? null,
  appOrigin: Deno.env.get('COMPLETION_RECEIPT_APP_ORIGIN') ?? null,
});

Deno.serve(handler);
