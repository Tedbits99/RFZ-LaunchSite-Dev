'use client';

import { useState } from 'react';

type GameArtworkGame = {
  slug?: string | null;
  name: string;
  short_name?: string | null;
  logo_url?: string | null;
};

const fallbackPalette: Record<string, string> = {
  'mobile-legends': 'from-indigo-500/50 via-cyan-500/20 to-blue-900/80',
  'pubg-mobile': 'from-amber-500/45 via-orange-500/20 to-slate-950/80',
  'free-fire': 'from-orange-500/45 via-rose-500/20 to-slate-950/80',
  'genshin-impact': 'from-sky-400/45 via-violet-500/20 to-slate-950/80',
  valorant: 'from-rose-500/45 via-red-500/20 to-slate-950/80',
  'honor-of-kings': 'from-fuchsia-500/40 via-violet-500/20 to-slate-950/80',
  roblox: 'from-emerald-500/40 via-cyan-500/20 to-slate-950/80',
  'call-of-duty-mobile': 'from-yellow-500/40 via-zinc-500/20 to-slate-950/80',
};

function safeImageUrl(value: string | null | undefined) {
  if (!value || !/^https:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function GameArtwork({ game, className = '', imageClassName = '', alt }: { game: GameArtworkGame; className?: string; imageClassName?: string; alt?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const remoteImage = safeImageUrl(game.logo_url);
  const imageSource = remoteImage;
  const fallbackClass = fallbackPalette[game.slug || ''] || 'from-cyan-500/40 via-blue-500/20 to-slate-950/80';
  const initials = (game.short_name || game.name).slice(0, 4).toUpperCase();

  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br ${fallbackClass} font-display text-xs font-bold text-cyan-100 ${className}`}>
      {imageSource && !imageFailed ? (
        <img src={imageSource} alt={alt ?? game.name} className={`h-full w-full object-cover ${imageClassName}`} onError={() => setImageFailed(true)} />
      ) : (
        <span aria-hidden="true" className="drop-shadow-sm">{initials}</span>
      )}
    </span>
  );
}
