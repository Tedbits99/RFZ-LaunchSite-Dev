export default function NotFound() {
  return (
    <main data-route-denial="not-found" className="flex min-h-screen items-center justify-center bg-[var(--rfz-bg)] px-6 text-[var(--rfz-text)]">
      <div className="flex items-center gap-5 text-sm">
        <span className="font-display text-4xl font-semibold">404</span>
        <span className="border-l border-[var(--rfz-line)] pl-5">This page could not be found.</span>
      </div>
    </main>
  );
}
