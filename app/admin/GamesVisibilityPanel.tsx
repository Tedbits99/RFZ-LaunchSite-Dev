'use client';

import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

type Game = { id: string; name: string; slug: string; is_active: boolean; is_featured: boolean };

export default function GamesVisibilityPanel({ initialGames }: { initialGames: Game[] }) {
  const [games, setGames] = useState<Game[]>(initialGames);
  const [toggling, setToggling] = useState<string | null>(null);

  const toggle = async (game: Game) => {
    setToggling(game.id);
    try {
      const res = await fetch('/api/games', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: game.id, is_active: !game.is_active }) });
      const data = await res.json() as { is_active?: boolean; error?: string };
      if (!res.ok) { alert(data.error || 'Failed to update game.'); return; }
      setGames((prev) => prev.map((g) => g.id === game.id ? { ...g, is_active: data.is_active! } : g));
    } catch (err) { alert(err instanceof Error ? err.message : 'Network error. Please try again.'); }
    finally { setToggling(null); }
  };

  return (
    <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-sm font-semibold">Games Visibility</h2>
          <p className="text-[11px] text-slate-500">Toggle games on or off for the storefront</p>
        </div>
        <a href="/admin/games" className="text-[11px] text-cyan-300 hover:underline">Manage all</a>
      </div>
      <div className="space-y-2">
        {games.length === 0 && <p className="text-xs text-slate-600">No games in catalog.</p>}
        {games.map((g) => (
          <div key={g.id} className="flex items-center justify-between rounded-lg border border-[#1b2a45] px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className={g.is_active ? 'text-emerald-300' : 'text-slate-600'}>
                {g.is_active ? <Eye size={14} /> : <EyeOff size={14} />}
              </span>
              <div>
                <p className="text-xs font-medium text-slate-200">{g.name}</p>
                <p className={`text-[10px] font-bold uppercase tracking-wider ${g.is_active ? 'text-emerald-300' : 'text-slate-500'}`}>{g.is_active ? 'ACTIVE' : 'DISABLED'}</p>
              </div>
            </div>
            <button
              onClick={() => toggle(g)}
              disabled={toggling === g.id}
              role="switch"
              aria-checked={g.is_active}
              aria-label={`Toggle ${g.name} visibility`}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${g.is_active ? 'bg-emerald-500/80' : 'bg-slate-600/60'} disabled:opacity-50`}
            >
              {toggling === g.id && <Loader2 size={11} className="absolute left-1/2 -translate-x-1/2 animate-spin text-white" />}
              {toggling !== g.id && <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${g.is_active ? 'translate-x-5' : 'translate-x-1'}`} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
