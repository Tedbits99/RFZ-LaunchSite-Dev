'use client';

import { useState } from 'react';

type GameField = {
  label: string;
  field_key: string;
  placeholder: string;
  help_text: string;
  is_required: boolean;
  sort_order: number;
};

type Game = {
  id?: string;
  name?: string;
  slug?: string;
  description?: string;
  region?: string;
  catalog_status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  is_active?: boolean;
  game_input_fields?: GameField[];
};

type GameForm = { slug: string; name: string; description: string; region: string; logo_url: string; cover_url: string; banner_url: string };

const blankForm = (): GameForm => ({ slug: '', name: '', description: '', region: 'Global', logo_url: '', cover_url: '', banner_url: '' });
const blankField = (sort_order = 0): GameField => ({ label: '', field_key: '', placeholder: '', help_text: '', is_required: true, sort_order });

export default function GameCatalogActions({ game, onSaved }: { game?: Game; onSaved?: (game: Game) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<GameForm>({ ...blankForm(), slug: game?.slug || '', name: game?.name || '', description: game?.description || '', region: game?.region || 'Global' });
  const [fields, setFields] = useState<GameField[]>(game?.game_input_fields || [blankField()]);

  async function openEditor() {
    setMessage('');
    if (!game?.id) {
      setForm(blankForm());
      setFields([blankField()]);
      setOpen(true);
      return;
    }
    setForm({ ...blankForm(), slug: game.slug || '', name: game.name || '', description: game.description || '', region: game.region || 'Global' });
    setFields(game.game_input_fields || []);
    setOpen(true);
    try {
      const response = await fetch('/api/admin/catalog/games');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load player fields.');
      const record = (result.data || []).find((row: { id: string }) => row.id === game.id);
      setFields((record?.game_input_fields || []).map((field: GameField, index: number) => ({ ...field, sort_order: index })));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load player fields.');
    }
  }

  async function send(body: Record<string, unknown>, closeDialog = false) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(game?.id ? `/api/admin/catalog/games/${game.id}` : '/api/admin/catalog/games', {
        method: game?.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Catalog request failed.');
      setMessage('Saved.');
      if (closeDialog) setOpen(false);
      onSaved?.(result.data);
      if (!game?.id || body.action) window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Catalog request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function lifecycle(action: 'publish' | 'hide' | 'archive' | 'restore') {
    if (!window.confirm(`Confirm ${action} for ${game?.name || 'this game'}?`)) return;
    await send({ action });
  }

  if (!game) {
    return <>
      <button type="button" onClick={() => void openEditor()} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white">＋ Add Game</button>
      {open && <GameDialog form={form} setForm={setForm} fields={fields} setFields={setFields} busy={busy} message={message} edit={false} onClose={() => setOpen(false)} onSubmit={() => send({ ...form, fields }, true)} />}
    </>;
  }

  return <div className="flex flex-wrap gap-1">
    <button type="button" onClick={() => void openEditor()} className="rounded border border-[#22314d] px-2 py-1 text-[11px] text-cyan-300">Edit</button>
    {game.catalog_status === 'ARCHIVED' ? <button type="button" disabled={busy} onClick={() => void lifecycle('restore')} className="rounded border border-amber-400/40 px-2 py-1 text-[11px] text-amber-300">Restore</button> : <>
      {game.catalog_status === 'PUBLISHED' ? <button type="button" disabled={busy} onClick={() => void lifecycle('hide')} className="rounded border border-slate-500/40 px-2 py-1 text-[11px] text-slate-300">Hide</button> : <button type="button" disabled={busy} onClick={() => void lifecycle('publish')} className="rounded border border-emerald-400/40 px-2 py-1 text-[11px] text-emerald-300">Publish</button>}
      <button type="button" disabled={busy} onClick={() => void lifecycle('archive')} className="rounded border border-rose-400/40 px-2 py-1 text-[11px] text-rose-300">Archive</button>
    </>}
    {message && <span role="status" className="self-center text-[10px] text-amber-300">{message}</span>}
    {open && <GameDialog form={form} setForm={setForm} fields={fields} setFields={setFields} busy={busy} message={message} edit onClose={() => setOpen(false)} onSubmit={() => send({ ...form, fields }, true)} />}
  </div>;
}

function GameDialog({ form, setForm, fields, setFields, busy, message, onClose, onSubmit, edit }: {
  form: GameForm;
  setForm: (value: GameForm) => void;
  fields: GameField[];
  setFields: (value: GameField[]) => void;
  busy: boolean;
  message: string;
  onClose: () => void;
  onSubmit: () => void;
  edit: boolean;
}) {
  function updateField(index: number, patch: Partial<GameField>) {
    setFields(fields.map((field, at) => at === index ? { ...field, ...patch } : field));
  }

  return <div role="dialog" aria-modal="true" aria-label={edit ? 'Edit game' : 'Add game'} className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 p-4">
    <form onSubmit={(event) => { event.preventDefault(); void onSubmit(); }} className="my-4 w-full max-w-2xl space-y-3 rounded-xl border border-[#29405f] bg-[#0b1225] p-5">
      <h2 className="text-lg font-semibold">{edit ? 'Edit game' : 'Add game'}</h2>
      {!edit && <label className="block text-xs text-slate-400">Slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-sm text-slate-100" /></label>}
      <label className="block text-xs text-slate-400">Name<input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-sm text-slate-100" /></label>
      <label className="block text-xs text-slate-400">Region<input required maxLength={80} value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-sm text-slate-100" /></label>
      <label className="block text-xs text-slate-400">Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-sm text-slate-100" /></label>
      <div className="grid gap-3 sm:grid-cols-3">
        {(['logo_url', 'cover_url', 'banner_url'] as const).map((key) => <label key={key} className="block text-xs text-slate-400">{key.replace('_', ' ')}<input type="url" pattern="https://.*" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} placeholder="https://…" className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-sm text-slate-100" /></label>)}
      </div>
      <section aria-label="Player input fields" className="space-y-2 rounded-lg border border-[#253451] p-3">
        <div className="flex items-center justify-between"><h3 className="text-sm font-medium">Player input fields</h3><button type="button" onClick={() => setFields([...fields, blankField(fields.length)])} className="rounded border border-[#253451] px-2 py-1 text-xs text-cyan-300">Add field</button></div>
        {fields.length === 0 && <p className="text-xs text-amber-300">At least one required player field is needed before publishing.</p>}
        {fields.map((field, index) => <div key={`${index}-${field.field_key}`} className="grid gap-2 rounded border border-[#1b2a45] p-2 sm:grid-cols-2">
          <label className="text-[11px] text-slate-400">Label<input aria-label={`Field ${index + 1} label`} required value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-xs text-slate-100" /></label>
          <label className="text-[11px] text-slate-400">Field key<input aria-label={`Field ${index + 1} key`} required pattern="[a-z][a-z0-9_]*" value={field.field_key} onChange={(event) => updateField(index, { field_key: event.target.value.toLowerCase() })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 font-mono text-xs text-slate-100" /></label>
          <label className="text-[11px] text-slate-400">Placeholder<input value={field.placeholder} onChange={(event) => updateField(index, { placeholder: event.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-xs text-slate-100" /></label>
          <label className="text-[11px] text-slate-400">Help text<input value={field.help_text} onChange={(event) => updateField(index, { help_text: event.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-xs text-slate-100" /></label>
          <div className="flex items-center justify-between sm:col-span-2"><label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={field.is_required} onChange={(event) => updateField(index, { is_required: event.target.checked })} /> Required</label><button type="button" onClick={() => setFields(fields.filter((_, at) => at !== index).map((row, at) => ({ ...row, sort_order: at })))} className="text-xs text-rose-300">Remove field</button></div>
        </div>)}
      </section>
      {message && <p role="status" className="text-xs text-amber-300">{message}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded border border-[#253451] px-3 py-2 text-xs text-slate-300">Cancel</button><button type="submit" disabled={busy || fields.some((field) => !field.label.trim() || !/^[a-z][a-z0-9_]*$/.test(field.field_key))} className="rounded bg-cyan-500/20 px-3 py-2 text-xs text-cyan-200 disabled:opacity-50">{busy ? 'Saving…' : 'Save draft'}</button></div>
    </form>
  </div>;
}
