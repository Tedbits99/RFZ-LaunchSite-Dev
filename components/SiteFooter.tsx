export default function SiteFooter() {
  return (
    <footer className="border-t border-[#14203a] bg-[#050a1b]/60">
      <div className="mx-auto max-w-[1180px] px-5 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-display text-sm font-semibold text-slate-200">Conditions</p>
            <div className="mt-3 space-y-2 text-xs text-slate-500">
              <a className="block transition hover:text-cyan-300" href="/terms-of-service">Terms of Service</a>
              <a className="block transition hover:text-cyan-300" href="/refund-policy">Refund &amp; Cancellation Policy</a>
              <a className="block transition hover:text-cyan-300" href="/payment-policy">Payment &amp; Delivery Policy</a>
            </div>
          </div>

          <div>
            <p className="font-display text-sm font-semibold text-slate-200">Support</p>
            <div className="mt-3 space-y-2 text-xs text-slate-500">
              <a className="block transition hover:text-cyan-300" href="/#faq">FAQ</a>
              <a className="block transition hover:text-cyan-300" href="/#contact">Contact Us</a>
              <a className="block transition hover:text-cyan-300" href="/track-order">Track Order</a>
            </div>
          </div>

          <div>
            <p className="font-display text-sm font-semibold text-slate-200">Privacy &amp; Legal</p>
            <div className="mt-3 space-y-2 text-xs text-slate-500">
              <a className="block transition hover:text-cyan-300" href="/privacy-policy">Privacy Policy</a>
              <a className="block transition hover:text-cyan-300" href="/copyright-disclaimer">Copyright &amp; Trademark Disclaimer</a>
            </div>
          </div>

          <div>
            <p className="font-display text-sm font-semibold text-slate-200">Follow Us</p>
            <div className="mt-3 space-y-2 text-xs text-slate-500">
              <a className="block transition hover:text-cyan-300" href="https://facebook.com/runfazone" rel="noopener noreferrer" target="_blank">Facebook</a>
              <a className="block transition hover:text-cyan-300" href="https://youtube.com/@runfazone" rel="noopener noreferrer" target="_blank">YouTube</a>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-[#14203a] pt-6 text-center">
          <p className="text-xs text-slate-400">Made for Gamers. Powered by Passion.</p>
          <p className="mt-1 text-[11px] text-slate-600">&copy; 2026 RunFazone. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
