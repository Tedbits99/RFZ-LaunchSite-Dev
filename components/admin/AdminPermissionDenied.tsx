export function AdminPermissionDenied({ feature }: { feature: string }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 text-slate-100">
      <section role="alert" aria-labelledby="admin-permission-denied" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5">
        <h1 id="admin-permission-denied" className="text-base font-semibold">Access unavailable</h1>
        <p className="mt-2 text-sm text-rose-200">Your current admin role is not permitted to view {feature}.</p>
        <a href="/admin" className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-rose-400/30 px-4 text-sm text-rose-100 hover:bg-rose-400/10">Return to admin overview</a>
      </section>
    </main>
  )
}
