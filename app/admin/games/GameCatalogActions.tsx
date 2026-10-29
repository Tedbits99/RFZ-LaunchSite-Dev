'use client';

import { useState } from 'react';

type Game = {
  id?: string;
  name?: string;
  slug?: string;
  description?: string;
  region?: string;
  catalog_status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  is_active?: boolean;
};

type Props = { game?: Game; onSaved?: (game: Game) => void };

export default function GameCatalogActions({ game, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    slug: game?.slug || '', name: game?.name || '', description: game?.description || '', region: game?.region || 'Global',
  });

  const request = async (body: Record<string, unknown>) => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(game?.id ? `/api/admin/catalog/games/${game.id}` : '/api/admin/catalog/games', {
        method: game?.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Catalog request failed.');
      setMessage('Saved.'); setOpen(false); onSaved?.(result.data);
      if (!game?.id) window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Catalog request failed.'); }
    finally { setBusy(false); }
  };

  if (!game) {
    return <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white">＋ Add Game</button>
      {open && <GameDialog form={form} setForm={setForm} busy={busy} message={message} onClose={() => setOpen(false)} onSubmit={() => request(form)} />}
    </>;
  }

  const action = async (name: string) => {
    if (!window.confirm(`Confirm ${name} for ${game.name || 'this game'}?`)) return;
    await request({ action: name });
    if (name === 'archive' || name === 'restore' || name === 'hide' || name === 'publish') window.location.reload();
  };
  return <div className="flex flex-wrap gap-1">
    <button type="button" onClick={() => setOpen(true)} className="rounded border border-[#22314d] px-2 py-1 text-[11px] text-cyan-300">Edit</button>
    {game.catalog_status === 'ARCHIVED' ? <button type="button" onClick={() => action('restore')} className="rounded border border-amber-400/40 px-2 py-1 text-[11px] text-amber-300">Restore</button> : <>
      {game.catalog_status === 'PUBLISHED' ? <button type="button" onClick={() => action('hide')} className="rounded border border-slate-500/40 px-2 py-1 text-[11px] text-slate-300">Hide</button> : <button type="button" onClick={() => action('publish')} className="rounded border border-emerald-400/40 px-2 py-1 text-[11px] text-emerald-300">Publish</button>}
      <button type="button" onClick={() => action('archive')} className="rounded border border-rose-400/40 px-2 py-1 text-[11px] text-rose-300">Archive</button>
    </>}
    {open && <GameDialog form={form} setForm={setForm} busy={busy} message={message} onClose={() => setOpen(false)} onSubmit={() => request(form)} edit />}
  </div>;
}

function GameDialog({ form, setForm, busy, message, onClose, onSubmit, edit = false }: {
  form: { slug: string; name: string; description: string; region: string };
  setForm: (value: { slug: string; name: string; description: string; region: string }) => void;
  busy: boolean; message: string; onClose: () => void; onSubmit: () => void; edit?: boolean;
}) {
  return <div role="dialog" aria-modal="true" aria-label={edit ? 'Edit game' : 'Add game'} className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
    <form onSubmit={(event) => { event.preventDefault(); void onSubmit(); }} className="w-full max-w-lg space-y-3 rounded-xl border border-[#29405f] bg-[#0b1225] p-5">
      <h2 className="text-lg font-semibold">{edit ? 'Edit game' : 'Add game'}</h2>
      {!edit && <label className="block text-xs text-slate-400">Slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-sm text-slate-100" /></label>}
      <label className="block text-xs text-slate-400">Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-sm text-slate-100" /></label>
      <label className="block text-xs text-slate-400">Region<input required value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-sm text-slate-100" /></label>
      <label className="block text-xs text-slate-400">Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-sm text-slate-100" /></label>
      {message && <p role="status" className="text-xs text-amber-300">{message}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded border border-[#253451] px-3 py-2 text-xs text-slate-300">Cancel</button><button type="submit" disabled={busy} className="rounded bg-cyan-500/20 px-3 py-2 text-xs text-cyan-200 disabled:opacity-50">{busy ? 'Saving…' : 'Save draft'}</button></div>
    </form>
  </div>;
}
