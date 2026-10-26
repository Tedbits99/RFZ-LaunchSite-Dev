'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, CheckCircle2 } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';

type PageState = 'loading' | 'idle' | 'pending' | 'saved' | 'error';

export default function ProfileClient() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<PageState>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/account/profile', { credentials: 'same-origin' });
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!res.ok) throw new Error('load failed');
        const body = await res.json() as { display_name?: string; email?: string };
        if (cancelled) return;
        setDisplayName(body.display_name ?? '');
        setEmail(body.email ?? '');
        setState('idle');
      } catch {
        if (!cancelled) {
          setError('Unable to load your profile right now.');
          setState('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'pending') return;
    setState('pending');
    setError('');
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ display_name: displayName }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error || 'Unable to save your profile right now.');
        setState('error');
        return;
      }
      setState('saved');
    } catch {
      setError('Unable to save your profile right now.');
      setState('error');
    }
  }

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/90"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><a href="/account" className="text-xs text-cyan-300">← Account</a></div></header>
      <div className="mx-auto max-w-2xl px-5 py-10">
        <nav className="flex items-center gap-2 text-xs text-slate-500"><Link href="/account">Account</Link><ChevronRight size={12} /><span className="text-slate-300">Profile</span></nav>
        <h1 className="font-display mt-4 text-2xl font-bold">Profile Settings</h1>
        {state === 'loading' ? (
          <div className="mt-6 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 text-sm text-slate-400">Loading your profile…</div>
        ) : state === 'saved' ? (
          <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-sm text-emerald-200">
            <CheckCircle2 size={20} className="mb-2 text-emerald-400" />
            <p>Profile updated.</p>
            <button onClick={() => setState('idle')} className="mt-3 rounded-lg border border-[#22314d] px-3 py-1.5 text-xs text-slate-300 hover:border-[#31456b]">Continue editing</button>
          </div>
        ) : (
          <form className="mt-6 space-y-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6" onSubmit={submit}>
            <label className="block"><span className="mb-1 block text-xs text-slate-400">Email (read-only)</span><div className="rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2.5 text-sm text-slate-400">{email || '—'}</div></label>
            <label className="block"><span className="mb-1 block text-xs text-slate-400">Display name</span><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={120} disabled={state === 'pending'} className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2.5 text-sm outline-none focus:border-cyan-500/50" /></label>
            {state === 'error' && error ? <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" role="alert">{error}</div> : null}
            <button type="submit" disabled={state === 'pending'} className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2.5 text-sm font-semibold disabled:opacity-50">{state === 'pending' ? 'Saving…' : 'Save changes'}</button>
          </form>
        )}
      </div>
      <SiteFooter />
    </main>
  );
}
