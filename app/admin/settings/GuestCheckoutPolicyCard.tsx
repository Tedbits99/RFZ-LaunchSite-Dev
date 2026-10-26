'use client';

import { useEffect, useState } from 'react';
import { Check, Globe2, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';

export default function GuestCheckoutPolicyCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/admin/settings', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as { allow_guest_checkout?: boolean | null; error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load checkout policy.');
        if (active) setEnabled(typeof data.allow_guest_checkout === 'boolean' ? data.allow_guest_checkout : null);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load checkout policy.'); });
    return () => { active = false; };
  }, []);

  const updatePolicy = async () => {
    if (enabled === null) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow_guest_checkout: !enabled }),
      });
      const data = await response.json() as { allow_guest_checkout?: boolean; error?: string };
      if (!response.ok || typeof data.allow_guest_checkout !== 'boolean') throw new Error(data.error || 'Could not update checkout policy.');
      setEnabled(data.allow_guest_checkout);
      setMessage('Policy saved.');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Could not update checkout policy.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="surface mt-6 p-5 sm:p-6" aria-labelledby="guest-checkout-policy-title">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-cyan-300"><ShieldCheck size={14} /> Store ordering policy</p>
          <h2 id="guest-checkout-policy-title" className="mt-2 font-display text-lg font-semibold text-[var(--rfz-ink)]">Guest checkout</h2>
          <p className="mt-1 max-w-xl text-sm text-[var(--rfz-muted)]">Choose whether customers must sign in before creating an order. The server and database enforce this policy for every checkout request.</p>
        </div>
        <button type="button" onClick={updatePolicy} disabled={saving || enabled === null} aria-pressed={enabled === true} aria-label={enabled ? 'Disable guest checkout' : 'Enable guest checkout'} className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? 'border-emerald-300/40 bg-emerald-400/70' : 'border-[var(--rfz-line-strong)] bg-[var(--rfz-surface-raised)]'}`}>
          {saving ? <Loader2 size={14} className="absolute left-1/2 -translate-x-1/2 animate-spin text-white" /> : <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />}
        </button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className={`rounded-xl border p-4 ${enabled === false ? 'border-cyan-300/30 bg-cyan-300/[.06]' : 'border-[var(--rfz-line)] bg-[var(--rfz-surface)]'}`}>
          <LockKeyhole size={17} className="text-cyan-300" />
          <p className="mt-2 text-sm font-semibold text-[var(--rfz-ink)]">Signed-in customers only</p>
          <p className="mt-1 text-xs text-[var(--rfz-muted)]">Recommended for a private storefront and account-owned orders.</p>
        </div>
        <div className={`rounded-xl border p-4 ${enabled === true ? 'border-emerald-300/30 bg-emerald-300/[.06]' : 'border-[var(--rfz-line)] bg-[var(--rfz-surface)]'}`}>
          <Globe2 size={17} className="text-emerald-300" />
          <p className="mt-2 text-sm font-semibold text-[var(--rfz-ink)]">Guest ordering enabled</p>
          <p className="mt-1 text-xs text-[var(--rfz-muted)]">Allows unsigned customers to place orders through the protected guest-access flow.</p>
        </div>
      </div>
      {enabled !== null && <p className="mt-4 flex items-center gap-2 text-xs text-[var(--rfz-muted)]" role="status"><Check size={14} className="text-emerald-300" /> Current setting: {enabled ? 'Guest checkout ON' : 'Signed-in customers only'}</p>}
      {message && <p className="mt-2 text-xs text-emerald-300" role="status">{message}</p>}
      {error && <p className="mt-2 text-xs text-rose-300" role="alert">{error}</p>}
    </section>
  );
}
