import { validateCanonicalAppOrigin } from '../../../lib/completionReceiptCore.ts';
import type { CompletionReceiptTransport } from './transportContract.ts';

export type WorkerConfig = {
  enabled: string | null;
  invocationSecret: string | null;
  appOrigin: string | null;
};

export type WorkerDependencies = {
  /** A fake-only seam for tests; E5.3A never invokes it. */
  transport?: CompletionReceiptTransport;
};

type FeatureState = 'disabled' | 'enabled' | 'invalid';

function featureState(value: string | null): FeatureState {
  if (value === null || value === 'false') return 'disabled';
  if (value === 'true') return 'enabled';
  return 'invalid';
}

function validSecret(secret: string | null): secret is string {
  return typeof secret === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(secret);
}

const MAX_AUTHORIZATION_LENGTH = 'Bearer '.length + 256;

// This equalizes comparison work; JavaScript scheduling/JIT and HTTP handling
// still prevent a hard end-to-end constant-time guarantee.
function exactBearerMatch(header: string | null, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const candidate = header ?? '';
  // Compare a fixed number of code units; length and missing-header differences
  // contribute to the result but never shorten the comparison loop.
  let mismatch = Number(header === null) | (candidate.length ^ expected.length);
  mismatch |= Number(candidate.length > MAX_AUTHORIZATION_LENGTH);
  for (let index = 0; index < MAX_AUTHORIZATION_LENGTH; index++) {
    mismatch |= (candidate.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function response(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** E5.3A handler is intentionally incapable of claiming rows or delivering mail. */
export function createCompletionReceiptWorkerHandler(
  config: WorkerConfig,
  _dependencies: WorkerDependencies = {},
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' });

    if (!validSecret(config.invocationSecret)) {
      return response(503, { error: 'Worker unavailable.' });
    }
    if (!exactBearerMatch(request.headers.get('authorization'), config.invocationSecret)) {
      return response(401, { error: 'Unauthorized.' });
    }

    const state = featureState(config.enabled);
    if (state === 'disabled') return response(200, { status: 'disabled' });
    if (state === 'invalid') return response(503, { error: 'Worker unavailable.' });

    try {
      validateCanonicalAppOrigin(config.appOrigin);
    } catch {
      return response(503, { error: 'Worker unavailable.' });
    }

    // Deliberately no RPC, receipt processing, or transport implementation in E5.3A.
    return response(503, { status: 'not_implemented' });
  };
}
