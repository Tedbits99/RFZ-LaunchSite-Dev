import { Skeleton } from '@/components/ui';

export default function AdminLoading() {
  return <main aria-busy="true" aria-label="Loading admin page" className="rfz-admin-shell min-h-[calc(100vh-73px)] p-5 sm:p-8"><Skeleton className="h-8 w-56" /><Skeleton className="mt-3 h-4 w-96 max-w-full" /><div className="mt-8 grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div></main>;
}
