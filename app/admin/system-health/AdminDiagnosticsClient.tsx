'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleHelp, RefreshCw, Shield } from 'lucide-react'

type Status = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_TESTED'
type Diagnostics = {
  checkedAt: string
  runtimeMode: string
  application: { status: Status; detail: string }
  adminSession: { status: Status; detail: string }
  database: { status: Status; detail: string; checkedAt: string }
  pricingSettings: { status: Status; usdPhpRate: number | null; feeReserveBps: number | null; fixedFeeCents: number | null }
  paymentMethods: { status: Status; methods: Array<{ key: string; enabled: boolean; testMode: boolean }> }
  guestCheckout: { status: Status; enabled: boolean | null }
  secretPresence: Array<{ name: string; configured: boolean }>
  releaseGates: Record<string, string>
  externalChecks: Record<string, string>
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'PASS' || status === 'LOCKED') return <CheckCircle2 className="text-emerald-300" size={17} aria-hidden="true" />
  if (status === 'FAIL' || status.includes('ENABLED')) return <AlertTriangle className="text-amber-300" size={17} aria-hidden="true" />
  return <CircleHelp className="text-slate-400" size={17} aria-hidden="true" />
}

function statusLabel(status: string) {
  if (status === 'PASS' || status === 'FAIL' || status === 'UNKNOWN' || status === 'NOT_TESTED') return status.replace('_', ' ')
  return status.replaceAll('_', ' ')
}

export default function AdminDiagnosticsClient({ mode }: { mode: 'health' | 'security' }) {
  const [data, setData] = useState<Diagnostics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/system-diagnostics', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Diagnostics could not be loaded.')
      setData(result as Diagnostics)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Diagnostics could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const isSecurity = mode === 'security'
  return (
    <section aria-labelledby="diagnostics-title">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Shield className="mt-1 text-cyan-300" size={20} aria-hidden="true" />
          <div>
            <h2 id="diagnostics-title" className="font-display text-2xl font-bold">{isSecurity ? 'Runtime security checks' : 'System health checks'}</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              These checks describe only the runtime serving this request. No payment, supplier, email, Cloudflare, or Auth-provider requests are made.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#253451] px-4 text-sm text-slate-200 disabled:opacity-50">
          <RefreshCw size={14} aria-hidden="true" /> {loading ? 'Checking…' : 'Refresh checks'}
        </button>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-200">{error}</p>}
      {loading && !data ? <p role="status" className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 text-sm text-slate-400">Checking runtime…</p> : data ? (
        <>
          <p className="mb-4 text-xs text-slate-500">Last checked {new Date(data.checkedAt).toLocaleString()} · runtime mode: {data.runtimeMode}. This does not identify a production project or deployment.</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <CheckCard title="Application request" status={data.application.status} detail={data.application.detail} />
            <CheckCard title="Admin session" status={data.adminSession.status} detail={data.adminSession.detail} />
            <CheckCard title="Connected database" status={data.database.status} detail={data.database.detail} />
            <CheckCard title="Pricing settings row" status={data.pricingSettings.status} detail={data.pricingSettings.status === 'PASS'
              ? 'FX reference ' + data.pricingSettings.usdPhpRate + '; fee reserve ' + (data.pricingSettings.feeReserveBps ?? 'not set') + ' bps; fixed fee ' + (data.pricingSettings.fixedFeeCents ?? 'not set') + ' cents.'
              : 'Values are unavailable; no successful database result was returned.'} />
            <CheckCard title="Guest checkout policy" status={data.guestCheckout.status} detail={data.guestCheckout.enabled === null ? 'Policy state is unknown.' : data.guestCheckout.enabled ? 'Guest checkout is enabled in this connected database.' : 'Guest checkout is disabled in this connected database.'} />
            <CheckCard title="Payment method configuration" status={data.paymentMethods.status} detail={data.paymentMethods.status === 'UNKNOWN' ? 'Payment configuration could not be read.' : String(data.paymentMethods.methods.length) + ' method(s) read. No provider connectivity was tested.'} />
          </div>

          {data.paymentMethods.methods.length > 0 && (
            <div className="mt-5 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-200">Configured payment methods</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {data.paymentMethods.methods.map((method) => <li key={method.key} className="flex items-center justify-between gap-3 rounded-lg border border-[#17243c] px-3 py-2 text-xs">
                  <span className="break-all text-slate-300">{method.key}</span>
                  <span className={method.enabled ? 'text-amber-200' : 'text-slate-400'}>{method.enabled ? 'Enabled' : 'Disabled'} · {method.testMode ? 'Test mode' : 'Live mode selected; provider not tested'}</span>
                </li>)}
              </ul>
              <p className="mt-3 text-[11px] text-slate-500">This is the connected runtime database configuration, not proof of successful or production provider connectivity.</p>
            </div>
          )}

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-200">Secret configuration presence</h3>
              <ul className="space-y-2">{data.secretPresence.map((item) => <li key={item.name} className="flex items-center justify-between gap-3 text-xs"><code className="break-all text-slate-400">{item.name}</code><span className={item.configured ? 'text-emerald-300' : 'text-slate-500'}>{item.configured ? 'Configured' : 'Missing'}</span></li>)}</ul>
              <p className="mt-3 text-[11px] text-slate-500">Only presence is shown; secret values are never returned.</p>
            </div>
            <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-200">Release gates</h3>
              <ul className="space-y-2">{Object.entries(data.releaseGates).map(([name, status]) => <li key={name} className="flex items-center justify-between gap-3 text-xs"><span className="capitalize text-slate-400">{name.replaceAll(/([A-Z])/g, ' $1')}</span><span className="inline-flex items-center gap-1.5 text-slate-300"><StatusIcon status={status} />{statusLabel(status)}</span></li>)}</ul>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <h3 className="mb-3 text-sm font-semibold text-amber-100">Checks not verifiable from this application request</h3>
            <ul className="grid gap-2 sm:grid-cols-2">{Object.entries(data.externalChecks).map(([name, status]) => <li key={name} className="flex items-center justify-between gap-3 text-xs"><span className="text-slate-300">{name.replaceAll(/([A-Z])/g, ' $1')}</span><span className="inline-flex items-center gap-1.5 text-amber-200"><StatusIcon status={status} />{statusLabel(status)}</span></li>)}</ul>
          </div>
        </>
      ) : null}
    </section>
  )
}

function CheckCard({ title, status, detail }: { title: string; status: string; detail: string }) {
  return <article className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-200">{title}</h3><span className="inline-flex items-center gap-1.5 text-xs text-slate-300"><StatusIcon status={status} />{statusLabel(status)}</span></div>
    <p className="mt-2 text-xs leading-5 text-slate-400">{detail}</p>
  </article>
}
