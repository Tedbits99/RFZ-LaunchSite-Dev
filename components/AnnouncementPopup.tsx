'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, Clock, ExternalLink, X } from 'lucide-react';

type AnnouncementData = {
  enabled: boolean;
  display_mode: string;
  type: string;
  title: string;
  message: string;
  button_text: string;
  button_link: string | null;
  return_date_time: string | null;
  show_countdown: boolean;
  image_url: string | null;
};

export default function AnnouncementPopup() {
  const [data, setData] = useState<AnnouncementData | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Local/OpenNext smoke builds intentionally omit Supabase configuration.
    // Avoid a noisy request to the unavailable announcement route in that
    // mode; the hosted preview still fetches announcements normally.
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    fetch('/api/announcement')
      .then((r) => r.json())
      .then((json) => {
        const a = json.data as AnnouncementData | null;
        if (!a || !a.enabled) return;
        if (a.return_date_time && new Date(a.return_date_time).getTime() < Date.now()) return;
        setData(a);
        setVisible(true);
      })
      .catch(() => {});
  }, []);

  const dismiss = useCallback(() => setVisible(false), []);

  if (!visible || !data) return null;

  const isBlocking = data.display_mode === 'blocking';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={isBlocking ? undefined : dismiss}
    >
      <div
        className="relative mx-4 w-full max-w-lg rounded-2xl border border-[#1b2a45] bg-gradient-to-br from-[#0c1a33] via-[#0a1228] to-[#140a28] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-2xl border-b border-[#1b2a45] bg-[#0b1225]/80 px-5 py-3">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-300">
            <Bell size={13} /> {data.type}
          </span>
        </div>

        {/* Optional image */}
        {data.image_url && (
          <div className="border-b border-[#1b2a45]">
                        <img src={data.image_url} alt="" className="h-40 w-full object-cover" />
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-6">
          <h2 className="font-display text-xl font-bold text-white">{data.title}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">{data.message}</p>

          {data.show_countdown && data.return_date_time && new Date(data.return_date_time).getTime() > Date.now() && <Countdown target={data.return_date_time} />}

          {!isBlocking && (
            <div className="mt-6 flex items-center gap-3">
              {data.button_link ? (
                <a
                  href={data.button_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2.5 text-sm font-semibold shadow-lg shadow-blue-900/30 transition hover:brightness-110"
                >
                  {data.button_text || 'OK'} <ExternalLink size={13} />
                </a>
              ) : (
                <button
                  onClick={dismiss}
                  className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2.5 text-sm font-semibold shadow-lg shadow-blue-900/30 transition hover:brightness-110"
                >
                  {data.button_text || 'OK'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Close button (only for normal mode) */}
        {!isBlocking && (
          <button onClick={dismiss} className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-white">
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Countdown({ target }: { target: string }) {
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
