import { AlertTriangle, Shield } from 'lucide-react';

export default function ControlledTestOrderClient() {
  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-amber-400/20 bg-[#0b1225] p-6 text-slate-100 sm:p-8">
      <div className="flex items-start gap-4">
        <div className="rounded-xl bg-amber-400/10 p-3 text-amber-300"><Shield size={22} /></div>
        <div>
          <h1 className="font-display text-xl font-bold">Supplier test orders are disabled</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            This tool no longer sends requests to FazerCards or creates supplier purchases.
            Use offline fixtures for development and automated checks.
          </p>
          <p role="status" className="mt-5 flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
            <AlertTriangle size={15} /> Live supplier diagnostics remain locked pending explicit owner release.
          </p>
        </div>
      </div>
    </section>
  );
}
