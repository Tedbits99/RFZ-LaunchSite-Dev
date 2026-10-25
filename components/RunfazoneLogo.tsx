export default function RunfazoneLogo({ className = '' }: { className?: string }) {
  return (
    <span aria-label="RunFazone" className={`inline-flex items-center gap-2 font-display font-bold tracking-tight ${className}`}>
      <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 via-blue-500 to-violet-600 text-lg font-black italic text-slate-950 shadow-lg shadow-cyan-950/30">R</span>
      <span className="text-[1.05em] text-white">RUN<span className="text-cyan-300">FAZONE</span></span>
    </span>
  );
}
