export default function RfzPulse({ label = 'Loading RunFazone', compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className={`rfz-pulse ${compact ? 'rfz-pulse-compact' : ''}`} role="status" aria-live="polite">
      <span className="rfz-pulse-mark" aria-hidden="true">
        <span className="rfz-pulse-trace" />
        <span className="rfz-pulse-core">R</span>
      </span>
      <span>{label}<span className="rfz-pulse-dots" aria-hidden="true">…</span></span>
    </div>
  );
}
