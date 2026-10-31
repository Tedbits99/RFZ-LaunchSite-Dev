import Link from 'next/link'
import { AdminPage } from '@/components/admin/AdminPage'
import { getAdminSession } from '@/lib/adminGuard'
import CheckoutPolicyControl from './CheckoutPolicyControl'

export const dynamic = 'force-dynamic'

function configured(name: string) {
  return Boolean(process.env[name]?.trim())
}

export default async function AdminSettingsPage() {
  const session = await getAdminSession()
  if (!session) return null

  const environment = [
    { name: 'NEXT_PUBLIC_APP_URL', present: configured('NEXT_PUBLIC_APP_URL'), secret: false },
    { name: 'NEXT_PUBLIC_SUPABASE_URL', present: configured('NEXT_PUBLIC_SUPABASE_URL'), secret: false },
    { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', present: configured('NEXT_PUBLIC_SUPABASE_ANON_KEY'), secret: true },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', present: configured('SUPABASE_SERVICE_ROLE_KEY'), secret: true },
    { name: 'PAYMENT_PROVIDER', present: configured('PAYMENT_PROVIDER'), secret: false },
    { name: 'PAYMENT_PAYMONGO_SECRET_KEY', present: configured('PAYMENT_PAYMONGO_SECRET_KEY'), secret: true },
    { name: 'PAYMENT_PAYMONGO_WEBHOOK_SECRET', present: configured('PAYMENT_PAYMONGO_WEBHOOK_SECRET'), secret: true },
    { name: 'STRIPE_SECRET_KEY', present: configured('STRIPE_SECRET_KEY'), secret: true },
    { name: 'FAZERCARDS_API_KEY', present: configured('FAZERCARDS_API_KEY') || configured('SUPPLIER_FAZERCARDS_API_KEY'), secret: true },
    { name: 'FAZERCARDS_WEBHOOK_SECRET', present: configured('FAZERCARDS_WEBHOOK_SECRET'), secret: true },
    { name: 'RESEND_API_KEY', present: configured('RESEND_API_KEY'), secret: true },
    { name: 'RFZ_CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET', present: configured('RFZ_CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET'), secret: true },
  ]

  return <AdminPage title="Central configuration">
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Central configuration</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">A map of persisted business settings and their existing source-of-truth screens. This page never displays secret values and does not claim hosted or production verification.</p>
      </header>

      <CheckoutPolicyControl role={session.role} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Business configuration areas">
        <ConfigLink href="/admin/pricing" title="Catalog prices and margin assumptions" detail="Retail package pricing, FX reference, fee reserve and supplier review state." />
        <ConfigLink href="/admin/payments" title="Payment method configuration" detail="Existing payment method enablement and test-mode controls; no provider requests are made here." />
        <ConfigLink href="/admin/suppliers" title="Supplier configuration" detail="Existing supplier catalog and fulfillment gates. This page does not enable fulfillment." />
        {session.role === 'SUPER_ADMIN' && <ConfigLink href="/admin/rf-coins" title="RF Coins controls" detail="Existing funding/spending lock controls. Activation remains separately gated." />}
        <ConfigLink href="/admin/system-health" title="Runtime diagnostics" detail="Read-only checks for this application runtime; external production state may remain unknown." />
        {session.role === 'SUPER_ADMIN' && <ConfigLink href="/admin/activity-log" title="Admin audit history" detail="Append-only operational audit events with protected read access." />}
      </section>

      <section className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5" aria-labelledby="runtime-config-title">
        <h2 id="runtime-config-title" className="font-display text-lg font-semibold">Current application runtime configuration</h2>
        <p className="mt-1 text-xs text-slate-500">Presence only. These values describe the server rendering this page and may differ from Cloudflare or another hosted environment.</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {environment.map((item) => <li key={item.name} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[#17243c] px-3 py-2">
            <code className="break-all text-xs text-slate-300">{item.name}</code>
            <span className={item.present ? 'shrink-0 text-xs text-emerald-300' : 'shrink-0 text-xs text-amber-300'}>{item.present ? 'Configured' : 'Missing'}{item.secret ? ' · value hidden' : ''}</span>
          </li>)}
        </ul>
      </section>
    </div>
  </AdminPage>
}

function ConfigLink({ href, title, detail }: { href: string; title: string; detail: string }) {
  return <Link href={href} className="block min-h-32 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5 transition hover:border-cyan-400/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
    <h2 className="font-display font-semibold text-slate-100">{title}</h2>
    <p className="mt-2 text-sm leading-5 text-slate-400">{detail}</p>
  </Link>
}
