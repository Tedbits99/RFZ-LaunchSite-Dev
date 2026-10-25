import RfzPulse from '@/components/RfzPulse';
import { Skeleton } from '@/components/ui';

type LoadingVariant = 'catalog' | 'product' | 'account' | 'wallet' | 'checkout' | 'admin';

export default function RouteLoading({ variant }: { variant: LoadingVariant }) {
  const isWide = variant === 'admin' || variant === 'catalog';
  return (
    <main aria-busy="true" aria-label={`Loading ${variant} page`} className="rfz-loading-shell mx-auto min-h-[60vh] max-w-[1180px] px-5 py-10 sm:py-12">
      <RfzPulse label={`Loading ${variant}`} />
      <div className="mt-8 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,.42fr)]">
        <section className="surface p-5 sm:p-7">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-3 h-4 w-72 max-w-full" />
          <div className={`mt-8 grid gap-3 ${isWide ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
            {Array.from({ length: isWide ? 6 : 4 }, (_, index) => <Skeleton key={index} className="h-28" />)}
          </div>
        </section>
        <aside className="surface hidden p-5 md:block">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-4 h-10 w-full" />
          <Skeleton className="mt-3 h-10 w-full" />
          <Skeleton className="mt-8 h-11 w-full" />
        </aside>
      </div>
    </main>
  );
}
