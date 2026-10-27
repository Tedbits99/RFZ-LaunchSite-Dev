import Link from 'next/link';

/** A quiet footer for the signed-in workspace; full legal navigation remains available. */
export default function AccountFooter() {
  return (
    <footer className="mt-12 border-t border-[#14203a] bg-[#050a1b]/50">
      <nav aria-label="Account support and legal links" className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-center gap-x-5 gap-y-2 px-5 py-5 text-[11px] text-slate-500 sm:justify-between">
        <span>© 2026 RunFazone</span>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Link className="hover:text-cyan-200" href="/track-order">Track order</Link>
          <Link className="hover:text-cyan-200" href="/#contact">Support</Link>
          <Link className="hover:text-cyan-200" href="/terms-of-service">Terms</Link>
          <Link className="hover:text-cyan-200" href="/privacy-policy">Privacy</Link>
        </div>
      </nav>
    </footer>
  );
}
