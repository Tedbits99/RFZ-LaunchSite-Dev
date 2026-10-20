import type { SupabaseClient } from '@supabase/supabase-js';

export type HealthSignal = { name: string; status: 'ok' | 'degraded' | 'unknown'; detail: string };

/** Read-only probes; failed or missing observations never become green. */
export async function getOperationalHealth(db: Pick<SupabaseClient, 'from'> | null): Promise<HealthSignal[]> {
  const unknown = (name: string): HealthSignal => ({ name, status: 'unknown', detail: 'Unable to verify database state.' });
  if (!db) return [unknown('Database'), unknown('Receipt queue')];
  async function count(status: string): Promise<number | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        db!.from('order_email_outbox').select('id', { count: 'exact', head: true }).eq('status', status),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Probe timeout')), 3000); }),
      ]);
      if (result.error || result.count === null) return null;
      return result.count;
    } catch { return null; }
    finally { if (timer) clearTimeout(timer); }
  }
  const [pending, processing, dead] = await Promise.all(['pending', 'processing', 'dead_letter'].map(count));
  if (pending === null || processing === null || dead === null) return [unknown('Database'), unknown('Receipt queue')];
  return [
    { name: 'Database', status: 'ok', detail: 'Receipt outbox queries completed.' },
    { name: 'Receipt queue', status: dead > 0 || pending > 0 || processing > 0 ? 'degraded' : 'ok', detail: `${pending} pending, ${processing} processing, ${dead} dead-letter. Counts do not establish worker availability.` },
  ];
}
