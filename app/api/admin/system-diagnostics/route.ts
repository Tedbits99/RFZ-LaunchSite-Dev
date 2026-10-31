import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdminPermission } from '@/lib/adminGuard'
import { RF_COINS_FUNDING_RELEASE_ENABLED, RF_COINS_SPENDING_RELEASE_ENABLED } from '@/lib/rfCoinFundingRelease'

export const dynamic = 'force-dynamic'

type CheckStatus = 'PASS' | 'FAIL' | 'UNKNOWN'

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'system.view')
  if (!auth.ok) return auth.response

  const checkedAt = new Date().toISOString()
  let database: { status: CheckStatus; checkedAt: string; detail: string } = {
    status: 'UNKNOWN',
    checkedAt,
    detail: 'Server-side Supabase client is not configured for this runtime.',
  }
  let pricingSettings: { status: CheckStatus; usdPhpRate: number | null; feeReserveBps: number | null; fixedFeeCents: number | null } = {
    status: 'UNKNOWN', usdPhpRate: null, feeReserveBps: null, fixedFeeCents: null,
  }
  let paymentMethods: { status: CheckStatus; methods: Array<{ key: string; enabled: boolean; testMode: boolean }> } = {
    status: 'UNKNOWN', methods: [],
  }
  let guestCheckout: { status: CheckStatus; enabled: boolean | null } = { status: 'UNKNOWN', enabled: null }

  if (adminSupabase) {
    const [{ data: settings, error: databaseError }, { data: paymentRows, error: paymentError }, { data: policy, error: policyError }] = await Promise.all([
      adminSupabase.from('app_settings').select('id,reference_usd_php_rate,payment_fee_reserve_bps,payment_fee_fixed_cents,supplier_fulfillment_release_enabled').eq('id', 1).maybeSingle(),
      adminSupabase.from('payment_config').select('method_key,is_enabled,is_test_mode').order('method_key').limit(100),
      adminSupabase.from('checkout_policy').select('allow_guest_checkout').eq('setting_key', 'allow_guest_checkout').maybeSingle(),
    ])
    database = databaseError
      ? { status: 'FAIL', checkedAt, detail: 'The read-only database health query failed.' }
      : settings
        ? { status: 'PASS', checkedAt, detail: 'A read-only query against app_settings succeeded.' }
        : { status: 'UNKNOWN', checkedAt, detail: 'The database responded, but the expected settings row was not found.' }
    pricingSettings = settings && !databaseError
      ? {
          status: 'PASS',
          usdPhpRate: Number(settings.reference_usd_php_rate),
          feeReserveBps: settings.payment_fee_reserve_bps == null ? null : Number(settings.payment_fee_reserve_bps),
          fixedFeeCents: settings.payment_fee_fixed_cents == null ? null : Number(settings.payment_fee_fixed_cents),
        }
      : { status: 'UNKNOWN', usdPhpRate: null, feeReserveBps: null, fixedFeeCents: null }
    paymentMethods = paymentError
      ? { status: 'UNKNOWN', methods: [] }
      : {
          status: 'PASS',
          methods: (paymentRows || []).map((row) => ({
            key: String(row.method_key),
            enabled: row.is_enabled === true,
            testMode: row.is_test_mode === true,
          })),
        }
    guestCheckout = policyError
      ? { status: 'UNKNOWN', enabled: null }
      : { status: policy ? 'PASS' : 'UNKNOWN', enabled: policy?.allow_guest_checkout ?? null }
  }

  return NextResponse.json({
    checkedAt,
    runtimeMode: process.env.NODE_ENV || 'unknown',
    application: { status: 'PASS', detail: 'This request was served by the running Next.js application.' },
    adminSession: { status: 'PASS', detail: 'The current request has an active admin session.' },
    database,
    pricingSettings,
    paymentMethods,
    guestCheckout,
    secretPresence: [
      { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) },
      { name: 'RESEND_API_KEY', configured: Boolean(process.env.RESEND_API_KEY) },
      { name: 'STRIPE_SECRET_KEY', configured: Boolean(process.env.STRIPE_SECRET_KEY) },
      { name: 'PAYMENT_PAYMONGO_SECRET_KEY', configured: Boolean(process.env.PAYMENT_PAYMONGO_SECRET_KEY) },
      { name: 'PAYMENT_PAYMONGO_WEBHOOK_SECRET', configured: Boolean(process.env.PAYMENT_PAYMONGO_WEBHOOK_SECRET) },
      { name: 'FAZERCARDS_API_KEY', configured: Boolean(process.env.FAZERCARDS_API_KEY || process.env.SUPPLIER_FAZERCARDS_API_KEY) },
      { name: 'FAZERCARDS_WEBHOOK_SECRET', configured: Boolean(process.env.FAZERCARDS_WEBHOOK_SECRET) },
      { name: 'RFZ_CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET', configured: Boolean(process.env.RFZ_CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET) },
      { name: 'SUPABASE_SERVICE_ROLE_KEY', configured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) },
    ],
    releaseGates: {
      supplierFulfillment: process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE === 'enabled' ? 'ENABLED_BY_RUNTIME_FLAG' : 'LOCKED',
      rfCoinsFunding: RF_COINS_FUNDING_RELEASE_ENABLED ? 'ENABLED' : 'LOCKED',
      rfCoinsSpending: RF_COINS_SPENDING_RELEASE_ENABLED ? 'ENABLED' : 'LOCKED',
      fazerCardsRevocation: 'UNVERIFIED_EXTERNALLY',
    },
    externalChecks: {
      productionEnvironmentIdentity: 'UNKNOWN',
      cloudflareWorkerAndAccess: 'UNKNOWN',
      supabaseRlsAndAuthRedirects: 'UNKNOWN',
      providerConnectivity: 'NOT_TESTED',
      emailDelivery: 'NOT_TESTED',
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
