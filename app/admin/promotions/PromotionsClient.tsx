'use client';

import { useState, useCallback } from 'react';
import {
  Save, Loader2, CheckCircle2, AlertTriangle, Megaphone, Plus, X,
  Calendar, Image as ImageIcon, ExternalLink, Layout, Gamepad2,
} from 'lucide-react';

type Placement = 'HOMEPAGE_HERO' | 'GAME_CARD' | 'GAME_DETAIL_HERO';

type Promotion = {
  id: string;
  title: string;
  body: string;
  target_type: 'GLOBAL' | 'GAME' | 'PACKAGE';
  game_id: string | null;
  package_id: string | null;
  image_url: string | null;
  cta_text: string | null;
  cta_href: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  sort_order: number;
  placement: string;
  target_game_id: string | null;
};

type NewPromo = {
  title: string;
  body: string;
  target_type: 'GLOBAL' | 'GAME' | 'PACKAGE';
  placement: Placement;
  target_game_id: string;
  image_url: string;
  cta_text: string;
  cta_href: string;
  is_active: boolean;
  sort_order: number;
  starts_at: string;
  ends_at: string;
};

type GameOption = { id: string; name: string };

const emptyNewPromo: NewPromo = {
  title: '',
  body: '',
  target_type: 'GLOBAL',
  placement: 'HOMEPAGE_HERO',
  target_game_id: '',
  image_url: '',
  cta_text: '',
  cta_href: '',
  is_active: true,
  sort_order: 0,
  starts_at: '',
  ends_at: '',
};

const targetColor: Record<string, string> = {
  GLOBAL: 'bg-cyan-500/10 text-cyan-300',
  GAME: 'bg-violet-500/10 text-violet-300',
  PACKAGE: 'bg-amber-500/10 text-amber-300',
};

const placementLabel: Record<string, string> = {
  HOMEPAGE_HERO: 'Homepage Hero',
  GAME_CARD: 'Game Card',
  GAME_DETAIL_HERO: 'Game Detail Hero',
};

const placementColor: Record<string, string> = {
  HOMEPAGE_HERO: 'bg-blue-500/10 text-blue-300',
  GAME_CARD: 'bg-emerald-500/10 text-emerald-300',
  GAME_DETAIL_HERO: 'bg-orange-500/10 text-orange-300',
};

function fmtDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString() : '—';
}

function isValidHttpsUrl(url: string): boolean {
  if (!url) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidUrl(url: string): boolean {
  if (!url) return true;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export default function PromotionsClient({ initialPromos, games }: { initialPromos: Promotion[]; games: GameOption[] }) {
  const [promos, setPromos] = useState(initialPromos);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newPromo, setNewPromo] = useState<NewPromo>(emptyNewPromo);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/promotions');
      const json = await res.json();
      if (json.data) setPromos(json.data as Promotion[]);
    } catch { /* silent */ }
  }, []);

  const update = (id: string, field: keyof Promotion, value: unknown) => {
    setPromos(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const save = async (promo: Promotion) => {
    if (promo.image_url && !isValidHttpsUrl(promo.image_url)) {
      setError('Image URL must be a valid HTTPS URL.');
      return;
    }
    setSavingId(promo.id);
    setError('');
    setSavedId(null);
    try {
      const res = await fetch('/api/promotions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: promo.id,
          image_url: promo.image_url || null,
          is_active: promo.is_active,
          placement: promo.placement,
          target_game_id: promo.target_game_id || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save.');
        return;
      }
      setSavedId(promo.id);
      setTimeout(() => setSavedId(null), 2000);
      await reload();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSavingId(null);
    }
  };

  const createPromo = async () => {
    if (!newPromo.title.trim()) {
      setError('Title is required.');
      return;
    }
    if (newPromo.image_url && !isValidHttpsUrl(newPromo.image_url)) {
      setError('Image URL must be a valid HTTPS URL.');
      return;
    }
    if (newPromo.cta_href && !isValidUrl(newPromo.cta_href)) {
      setError('CTA link must be a valid URL.');
      return;
    }
    if ((newPromo.placement === 'GAME_CARD' || newPromo.placement === 'GAME_DETAIL_HERO') && !newPromo.target_game_id) {
      setError('A target game is required for this banner placement.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newPromo.title.trim(),
          body: newPromo.body.trim(),
          target_type: newPromo.target_type,
          placement: newPromo.placement,
          target_game_id: newPromo.target_game_id || null,
          image_url: newPromo.image_url.trim() || null,
          cta_text: newPromo.cta_text.trim() || null,
          cta_href: newPromo.cta_href.trim() || null,
          is_active: newPromo.is_active,
          sort_order: newPromo.sort_order,
          starts_at: newPromo.starts_at || undefined,
          ends_at: newPromo.ends_at || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create promotion.');
        return;
      }
      setShowCreate(false);
      setNewPromo(emptyNewPromo);
      await reload();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setCreating(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-300 outline-none focus:border-cyan-400';
  const labelCls = 'mb-1 block text-xs text-slate-400';

  const newImageUrlError = newPromo.image_url && !isValidHttpsUrl(newPromo.image_url);
  const newCtaError = newPromo.cta_href && !isValidUrl(newPromo.cta_href);
  const needsGameSelect = newPromo.placement === 'GAME_CARD' || newPromo.placement === 'GAME_DETAIL_HERO';

  function gameNameById(id: string | null): string {
    if (!id) return '';
    return games.find(g => g.id === id)?.name || id.slice(0, 8);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-300">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {!showCreate && (
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
        >
          <Plus size={16} /> Add Promotion
        </button>
      )}

      {showCreate && (
        <div className="rounded-xl border border-cyan-500/30 bg-[#0b1225] p-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Plus size={16} className="text-cyan-300" /> New Promotion
            </h3>
            <button
              onClick={() => { setShowCreate(false); setNewPromo(emptyNewPromo); setError(''); }}
              className="text-slate-500 hover:text-slate-300"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Title *</span>
                <input
                  value={newPromo.title}
                  onChange={e => setNewPromo(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Summer Sale"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Promotion Type</span>
                <select
                  value={newPromo.target_type}
                  onChange={e => setNewPromo(p => ({ ...p, target_type: e.target.value as NewPromo['target_type'] }))}
                  className={inputCls}
                >
                  <option value="GLOBAL">Global</option>
                  <option value="GAME">Game</option>
                  <option value="PACKAGE">Package</option>
                </select>
              </label>
            </div>

            <label className="block">
              <span className={labelCls}>Banner Placement</span>
              <select
                value={newPromo.placement}
                onChange={e => setNewPromo(p => ({ ...p, placement: e.target.value as Placement, target_game_id: e.target.value === 'HOMEPAGE_HERO' ? '' : p.target_game_id }))}
                className={inputCls}
              >
                <option value="HOMEPAGE_HERO">Homepage Hero Banner</option>
                <option value="GAME_CARD">Game Card Banner</option>
                <option value="GAME_DETAIL_HERO">Game Detail Hero Banner</option>
              </select>
            </label>

            {needsGameSelect && (
              <label className="block">
                <span className={labelCls}>Target Game *</span>
                <select
                  value={newPromo.target_game_id}
                  onChange={e => setNewPromo(p => ({ ...p, target_game_id: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">Select a game…</option>
                  {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}

            <label className="block">
              <span className={labelCls}>Description</span>
              <textarea
                value={newPromo.body}
                onChange={e => setNewPromo(p => ({ ...p, body: e.target.value }))}
                placeholder="Promotion description shown on the admin card"
                rows={2}
                className={inputCls}
              />
            </label>

            <div>
              <label className="block">
                <span className={labelCls}>Banner Image URL (HTTPS)</span>
                <input
                  value={newPromo.image_url}
                  onChange={e => setNewPromo(p => ({ ...p, image_url: e.target.value }))}
                  placeholder="https://example.com/banner.jpg"
                  className={inputCls}
                />
              </label>
              {newImageUrlError && (
                <p className="mt-1 text-xs text-rose-400">URL must start with https://</p>
              )}
              {newPromo.image_url && !newImageUrlError && (
                <div className="mt-2">
                  <span className={labelCls}>Preview</span>
                  <div className="overflow-hidden rounded-lg border border-[#1b2a45]">
                                        <img
                      src={newPromo.image_url}
                      alt="New promotion banner preview"
                      className="h-40 w-full object-contain bg-[#0a1124]"
                      onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
                    />
                  </div>
                  <a href={newPromo.image_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline">
                    <ExternalLink size={11} /> Open URL
                  </a>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>CTA Text</span>
                <input
                  value={newPromo.cta_text}
                  onChange={e => setNewPromo(p => ({ ...p, cta_text: e.target.value }))}
                  placeholder="e.g. Shop Now"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>CTA Link</span>
                <input
                  value={newPromo.cta_href}
                  onChange={e => setNewPromo(p => ({ ...p, cta_href: e.target.value }))}
                  placeholder="https://runfazone.com/games/mobile-legends"
                  className={inputCls}
                />
              </label>
            </div>
            {newCtaError && (
              <p className="text-xs text-rose-400">CTA link must be a valid URL.</p>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className={labelCls}>Sort Order</span>
                <input
                  type="number"
                  value={newPromo.sort_order}
                  onChange={e => setNewPromo(p => ({ ...p, sort_order: Number(e.target.value) }))}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Start Date</span>
                <input
                  type="date"
                  value={newPromo.starts_at}
                  onChange={e => setNewPromo(p => ({ ...p, starts_at: e.target.value }))}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>End Date</span>
                <input
                  type="date"
                  value={newPromo.ends_at}
                  onChange={e => setNewPromo(p => ({ ...p, ends_at: e.target.value }))}
                  className={inputCls}
                />
              </label>
            </div>

            <label className="flex items-center gap-2">
              <button
                onClick={() => setNewPromo(p => ({ ...p, is_active: !p.is_active }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${newPromo.is_active ? 'bg-emerald-500/80' : 'bg-slate-600/60'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${newPromo.is_active ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
              <span className="text-xs text-slate-400">Active</span>
            </label>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowCreate(false); setNewPromo(emptyNewPromo); setError(''); }}
                className="rounded-lg border border-[#253451] px-4 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                onClick={createPromo}
                disabled={creating || !newPromo.title.trim() || !!newImageUrlError || !!newCtaError || (needsGameSelect && !newPromo.target_game_id)}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Create Promotion
              </button>
            </div>
          </div>
        </div>
      )}

      {promos.map(p => {
        const expanded = expandedId === p.id;
        const urlError = p.image_url && !isValidHttpsUrl(p.image_url);
        const promoPlacement = (placementLabel[p.placement] || p.placement || 'Homepage Hero');
        const promoPlacementColor = placementColor[p.placement] || placementColor.HOMEPAGE_HERO;
        return (
          <div key={p.id} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Megaphone className="text-violet-300" size={18} />
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${targetColor[p.target_type]}`}>
                  {p.target_type}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${promoPlacementColor}`}>
                  <Layout size={10} /> {promoPlacement}
                </span>
                {p.target_game_id && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                    <Gamepad2 size={10} /> {gameNameById(p.target_game_id)}
                  </span>
                )}
                <span className="text-sm font-semibold text-slate-200">{p.title}</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const updated = { ...p, is_active: !p.is_active };
                    update(p.id, 'is_active', !p.is_active);
                    save(updated);
                  }}
                  disabled={savingId === p.id}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${p.is_active ? 'bg-emerald-500/80' : 'bg-slate-600/60'} disabled:opacity-40`}
                  aria-label={p.is_active ? 'Active' : 'Inactive'}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${p.is_active ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
                <button
                  onClick={() => setExpandedId(expanded ? null : p.id)}
                  className="text-xs text-slate-500 hover:text-cyan-300"
                >
                  {expanded ? 'Collapse' : 'Edit'}
                </button>
              </div>
            </div>

            {p.body && <p className="mt-1 text-xs text-slate-400">{p.body}</p>}

            {p.cta_text && (
              <div className="mt-2 text-xs text-slate-500">
                CTA: <span className="text-slate-300">{p.cta_text}</span>
                {p.cta_href && <> → <span className="text-cyan-300">{p.cta_href}</span></>}
              </div>
            )}

            <div className="mt-3 flex items-center gap-1.5 border-t border-[#1b2a45] pt-3 text-[10px] text-slate-500">
              <Calendar size={12} />
              <span>{fmtDate(p.starts_at)}</span>
              <span className="text-slate-600">→</span>
              <span>{fmtDate(p.ends_at)}</span>
              <span className="ml-auto">Sort: {p.sort_order}</span>
            </div>

            {expanded && (
              <div className="mt-4 space-y-4 border-t border-[#1b2a45] pt-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={labelCls}>Banner Placement</span>
                    <select
                      value={p.placement || 'HOMEPAGE_HERO'}
                      onChange={e => update(p.id, 'placement', e.target.value)}
                      className={inputCls}
                    >
                      <option value="HOMEPAGE_HERO">Homepage Hero Banner</option>
                      <option value="GAME_CARD">Game Card Banner</option>
                      <option value="GAME_DETAIL_HERO">Game Detail Hero Banner</option>
                    </select>
                  </label>
                  {((p.placement === 'GAME_CARD') || (p.placement === 'GAME_DETAIL_HERO')) && (
                    <label className="block">
                      <span className={labelCls}>Target Game</span>
                      <select
                        value={p.target_game_id || ''}
                        onChange={e => update(p.id, 'target_game_id', e.target.value || null)}
                        className={inputCls}
                      >
                        <option value="">Select a game…</option>
                        {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </label>
                  )}
                </div>

                <div>
                  <label className="block">
                    <span className={labelCls}>Banner Image URL (HTTPS)</span>
                    <input
                      value={p.image_url || ''}
                      onChange={e => update(p.id, 'image_url', e.target.value)}
                      placeholder="https://example.com/banner.jpg"
                      className={inputCls}
                    />
                  </label>
                  {urlError && (
                    <p className="mt-1 text-xs text-rose-400">URL must start with https://</p>
                  )}
                  {p.image_url && !urlError && (
                    <a href={p.image_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline">
                      <ExternalLink size={11} /> Open URL
                    </a>
                  )}
                </div>

                {p.image_url && !urlError && (
                  <div>
                    <span className={labelCls}>Preview</span>
                    <div className="overflow-hidden rounded-lg border border-[#1b2a45]">
                                            <img
                        src={p.image_url}
                        alt={`${p.title} banner preview`}
                        className="h-40 w-full object-contain bg-[#0a1124]"
                        onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
                      />
                    </div>
                  </div>
                )}

                {!p.image_url && (
                  <div className="flex items-center gap-2 rounded-lg border border-[#1b2a45] bg-[#0a1124] px-3 py-3 text-xs text-slate-500">
                    <ImageIcon size={14} />
                    No image URL set — the default background will be used.
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={() => save(p)}
                    disabled={savingId === p.id || !!urlError}
                    className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                  >
                    {savingId === p.id ? <Loader2 size={14} className="animate-spin" /> : savedId === p.id ? <CheckCircle2 size={14} /> : <Save size={14} />}
                    {savedId === p.id ? 'Saved' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
