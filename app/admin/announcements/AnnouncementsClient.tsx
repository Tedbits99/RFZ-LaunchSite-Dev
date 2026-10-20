'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, Eye, EyeOff, Loader2, Save, X, ExternalLink, Clock, Image as ImageIcon } from 'lucide-react';

const TYPES = ['Online', 'Promotion', 'Event', 'Maintenance', 'Closed', 'Not Accepting Orders', 'Upgrading', 'Temporarily Unavailable', 'Offline', 'Custom'] as const;
const DISPLAY_MODES = ['normal', 'blocking'] as const;

type Announcement = {
  id?: string;
  enabled: boolean;
  display_mode: string;
  type: string;
  title: string;
  message: string;
  button_text: string;
  button_link: string;
  return_date_time: string;
  show_countdown: boolean;
  image_url: string;
};

const empty: Announcement = { enabled: false, display_mode: 'normal', type: 'Maintenance', title: '', message: '', button_text: 'OK', button_link: '', return_date_time: '', show_countdown: false, image_url: '' };

export default function AnnouncementsClient() {
  const [form, setForm] = useState<Announcement>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/announcement');
      const json = await res.json();
      if (json.data) {
        setForm({
          id: json.data.id,
          enabled: json.data.enabled ?? false,
          display_mode: json.data.display_mode ?? 'normal',
          type: json.data.type ?? 'Maintenance',
          title: json.data.title ?? '',
          message: json.data.message ?? '',
          button_text: json.data.button_text ?? 'OK',
          button_link: json.data.button_link ?? '',
          return_date_time: json.data.return_date_time ? (() => { const d = new Date(json.data.return_date_time); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); })() : '',
          show_countdown: json.data.show_countdown ?? false,
          image_url: json.data.image_url ?? '',
        });
      }
    } catch {
      setStatus({ type: 'error', msg: 'Failed to load announcement settings.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const body = { ...form, return_date_time: form.return_date_time ? new Date(form.return_date_time).toISOString() : null };
      const res = await fetch('/api/announcement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) { setStatus({ type: 'error', msg: json.error || 'Save failed.' }); return; }
      if (json.data?.id) setForm((f) => ({ ...f, id: json.data.id }));
      setStatus({ type: 'success', msg: 'Announcement saved successfully!' });
    } catch {
      setStatus({ type: 'error', msg: 'Network error. Try again.' });
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Announcement>(key: K, val: Announcement[K]) => setForm((f) => ({ ...f, [key]: val }));

  const labelCls = 'block text-xs font-medium text-slate-300 mb-1.5';
  const inputCls = 'w-full rounded-lg border border-[#253451] bg-[#0a1124] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-400 transition placeholder:text-slate-600';
  const selectCls = inputCls + ' appearance-none';

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin text-cyan-300" size={28} />
    </div>
  );

  return (
    <>
      <div className="space-y-6">
        {/* Status badge */}
        <div className="flex items-center justify-between rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <div className="flex items-center gap-3">
            <Bell size={18} className={form.enabled ? 'text-emerald-300' : 'text-slate-500'} />
            <div>
              <p className="text-sm font-semibold">{form.enabled ? 'Announcement is LIVE' : 'Announcement is OFF'}</p>
              <p className="text-[11px] text-slate-500">{form.enabled ? 'Visitors will see this popup on the storefront.' : 'Enable to show the popup to visitors.'}</p>
            </div>
          </div>
          <button
            onClick={() => set('enabled', !form.enabled)}
            role="switch"
            aria-checked={form.enabled}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${form.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${form.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* Form fields */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
            <h3 className="text-sm font-semibold text-slate-200">Appearance</h3>

            <div>
              <label className={labelCls}>Display Mode</label>
              <select value={form.display_mode} onChange={(e) => set('display_mode', e.target.value)} className={selectCls}>
                {DISPLAY_MODES.map((m) => <option key={m} value={m}>{m === 'normal' ? 'Normal (dismissible)' : 'Blocking (full-screen overlay)'}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Type</label>
              <select value={form.type} onChange={(e) => set('type', e.target.value)} className={selectCls}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Title</label>
              <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Scheduled Maintenance" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Message</label>
              <textarea value={form.message} onChange={(e) => set('message', e.target.value)} placeholder="Tell your customers what's happening..." rows={4} className={inputCls + ' resize-y'} />
            </div>
          </div>

          <div className="space-y-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
            <h3 className="text-sm font-semibold text-slate-200">Actions & Extras</h3>

            <div>
              <label className={labelCls}>Button Text</label>
              <input value={form.button_text} onChange={(e) => set('button_text', e.target.value)} placeholder="OK" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Button Link <span className="text-slate-500">(optional)</span></label>
              <input value={form.button_link} onChange={(e) => set('button_link', e.target.value)} placeholder="https://..." className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Return Date & Time <span className="text-slate-500">(optional)</span></label>
              <input type="datetime-local" value={form.return_date_time} onChange={(e) => set('return_date_time', e.target.value)} className={inputCls} />
              <p className="mt-1 text-[10px] text-slate-500">Announcement auto-hides after this time.</p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-[#253451] px-3 py-3">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-cyan-300" />
                <span className="text-xs text-slate-300">Show countdown timer</span>
              </div>
              <button
                onClick={() => set('show_countdown', !form.show_countdown)}
                role="switch"
                aria-checked={form.show_countdown}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${form.show_countdown ? 'bg-cyan-500' : 'bg-slate-600'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${form.show_countdown ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>

            <div>
              <label className={labelCls}>Image URL <span className="text-slate-500">(optional)</span></label>
              <input value={form.image_url} onChange={(e) => set('image_url', e.target.value)} placeholder="https://..." className={inputCls} />
              {form.image_url && (
                <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                  <ImageIcon size={12} />
                  <span className="truncate">{form.image_url}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status message */}
        {status && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${status.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
            {status.msg}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2.5 text-sm font-semibold shadow-lg shadow-blue-900/30 transition hover:brightness-110 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          <button onClick={() => setShowPreview(true)} className="flex items-center gap-2 rounded-lg border border-[#253451] px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:border-cyan-400 hover:text-white">
            <Eye size={14} /> Preview
          </button>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && <PreviewModal announcement={form} onClose={() => setShowPreview(false)} />}
    </>
  );
}

/* ---------- Preview overlay – shows exactly what storefront visitors see ---------- */

function PreviewModal({ announcement, onClose }: { announcement: Announcement; onClose: () => void }) {
  const a = announcement;
  const isBlocking = a.display_mode === 'blocking';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={isBlocking ? undefined : onClose}>
      <div className="relative mx-4 w-full max-w-lg animate-in rounded-2xl border border-[#1b2a45] bg-gradient-to-br from-[#0c1a33] via-[#0a1228] to-[#140a28] p-0 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Banner tag */}
        <div className="flex items-center justify-between rounded-t-2xl border-b border-[#1b2a45] bg-[#0b1225]/80 px-5 py-3">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-300">
            <Bell size={13} /> {a.type}
          </span>
          <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">{isBlocking ? 'Blocking' : 'Normal'}</span>
        </div>

        {a.image_url && (
          <div className="border-b border-[#1b2a45]">
                        <img src={a.image_url} alt="" className="h-40 w-full object-cover" />
          </div>
        )}

        <div className="px-6 py-6">
          <h2 className="font-display text-xl font-bold text-white">{a.title || 'Announcement Title'}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">{a.message || 'Your message will appear here.'}</p>

          {a.show_countdown && a.return_date_time && <CountdownDisplay target={a.return_date_time} />}

          <div className="mt-6 flex items-center gap-3">
            {a.button_link ? (
              <a href={a.button_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2.5 text-sm font-semibold shadow-lg shadow-blue-900/30 transition hover:brightness-110">
                {a.button_text || 'OK'} <ExternalLink size={13} />
              </a>
            ) : (
              <button onClick={onClose} className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2.5 text-sm font-semibold shadow-lg shadow-blue-900/30 transition hover:brightness-110">
                {a.button_text || 'OK'}
              </button>
            )}
            {!isBlocking && (
              <button onClick={onClose} className="rounded-lg border border-[#253451] px-4 py-2.5 text-sm text-slate-400 transition hover:border-slate-400 hover:text-white">
                Close
              </button>
            )}
          </div>
        </div>

        {!isBlocking && (
          <button onClick={onClose} className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-white">
            <X size={14} />
          </button>
        )}

        <p className="border-t border-[#1b2a45] px-6 py-3 text-center text-[10px] uppercase tracking-wider text-slate-600">Admin Preview</p>
      </div>
    </div>
  );
}

/* ---------- Countdown ---------- */

function CountdownDisplay({ target }: { target: string }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const calc = () => {
      const diff = new Date(target).getTime() - Date.now();
      if (diff <= 0) { setRemaining('Time reached'); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const parts: string[] = [];
      if (d) parts.push(`${d}d`);
      parts.push(`${h}h`, `${m}m`, `${s}s`);
      setRemaining(parts.join(' '));
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [target]);

  return (
    <div className="mt-4 flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-4 py-2.5">
      <Clock size={14} className="text-cyan-300" />
      <span className="text-xs text-cyan-200">Returning in: <span className="font-mono font-semibold">{remaining}</span></span>
    </div>
  );
}
