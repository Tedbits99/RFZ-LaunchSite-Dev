import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edgeSource = readFileSync(
  new URL('../supabase/functions/send-transactional-email/index.ts', import.meta.url),
  'utf8',
);
const nextCallerSource = readFileSync(new URL('./transactionalEmail.ts', import.meta.url), 'utf8');
const webhookSource = readFileSync(
  new URL('../supabase/functions/payment-webhook/index.ts', import.meta.url),
  'utf8',
);

describe('transactional email Edge Function authorization contract', () => {
  it('authorizes before parsing the request or inspecting the template', () => {
    const authorizationIndex = edgeSource.indexOf(
      'hasAuthorizedTransactionalEmailRequest(req, SERVICE_KEY)',
    );
    const bodyParseIndex = edgeSource.indexOf('const body = await req.json()');

    expect(authorizationIndex).toBeGreaterThan(-1);
    expect(bodyParseIndex).toBeGreaterThan(authorizationIndex);
  });

  it('applies one authorization gate to every supported template', () => {
    expect(edgeSource).toContain('payment_success');
    expect(edgeSource).toContain('fulfillment_failed');
    expect(edgeSource).toContain('guest_order_access');
    expect(edgeSource).toContain('if (!hasAuthorizedTransactionalEmailRequest(req, SERVICE_KEY))');
    expect(edgeSource).not.toContain('Access-Control-Allow-Origin');
  });

  it('does not use a public anonymous key for internal email invocation', () => {
    expect(nextCallerSource).toContain('process.env.SUPABASE_SERVICE_ROLE_KEY');
    expect(nextCallerSource).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(nextCallerSource).not.toContain('SUPABASE_ANON_KEY');
    expect(webhookSource).toContain('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
    expect(webhookSource).not.toContain('Deno.env.get("SUPABASE_ANON_KEY")');
  });
});
