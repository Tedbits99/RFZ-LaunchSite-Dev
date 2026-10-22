import { Skeleton } from '@/components/ui';

export default function Loading() {
  return <main aria-busy="true" aria-label="Loading page" className="mx-auto min-h-[60vh] max-w-[1180px] px-5 py-12"><Skeleton className="h-8 w-48" /><Skeleton className="mt-3 h-4 w-80 max-w-full" /><div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div></main>;
}
