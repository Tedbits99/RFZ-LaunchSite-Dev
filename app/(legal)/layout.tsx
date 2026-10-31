import SiteFooter from '@/components/SiteFooter';
import ThemeSelector from '@/components/ThemeSelector';
import CustomerAccountMenu from '@/components/CustomerAccountMenu';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/90">
        <div className="mx-auto flex max-w-[860px] items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-5 sm:py-4">
          <a href="/" className="shrink-0 text-xs text-cyan-300">&larr; Back to store</a><div className="flex shrink-0 items-center gap-2"><CustomerAccountMenu compactOnMobile /><ThemeSelector /></div>
        </div>
      </header>
      <div className="mx-auto max-w-[860px] px-5 py-12">{children}</div>
      <SiteFooter />
    </main>
  );
}
