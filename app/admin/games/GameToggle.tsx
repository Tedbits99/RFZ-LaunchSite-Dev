'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

type GameToggleProps = {
  id: string;
  name: string;
  is_active: boolean;
};

export default function GameToggle({ id, name, is_active }: GameToggleProps) {
  const [active, setActive] = useState(is_active);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setToggling(true);
    setError(null);
    try {
      const res = await fetch('/api/games', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: !active }),
      });
      const data = await res.json() as { is_active?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      setActive(data.is_active ?? !active);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach the server. Please try again.');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${active ? 'text-emerald-300' : 'text-slate-500'}`}>
          {active ? 'ACTIVE' : 'DISABLED'}
        </span>
        <button
          onClick={toggle}
          disabled={toggling}
          role="switch"
          aria-checked={active}
          aria-label={`Toggle ${name} visibility`}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${active ? 'bg-emerald-500/80' : 'bg-slate-600/60'} disabled:opacity-50`}
        >
          {toggling && <Loader2 size={11} className="absolute left-1/2 -translate-x-1/2 animate-spin text-white" />}
          {toggling === false && (
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${active ? 'translate-x-5' : 'translate-x-1'}`} />
          )}
        </button>
      </div>
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
    </div>
  );
}
