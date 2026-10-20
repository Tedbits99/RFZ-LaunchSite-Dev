import { describe, it, expect, vi } from 'vitest';
import { getOperationalHealth } from './operationalHealth';
import type { SupabaseClient } from '@supabase/supabase-js';
function database(counts: Record<string, number | null>, error: unknown = null) {
  return { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn((_key: string, status: string) => Promise.resolve({ count: counts[status], error })) })) })) } as unknown as Pick<SupabaseClient, 'from'>;
}
describe('database-backed operational health', () => {
  it('never reports a missing database healthy', async () => {
    expect((await getOperationalHealth(null)).every((s) => s.status === 'unknown')).toBe(true);
  });
  it('reports query failures as unknown, not an empty healthy queue', async () => {
    expect((await getOperationalHealth(database({}, new Error('private connection detail')))).every((s) => s.status === 'unknown')).toBe(true);
  });
  it('reports durable failures and backlog as degraded', async () => {
    expect(await getOperationalHealth(database({ pending: 2, processing: 1, dead_letter: 3 }))).toContainEqual(expect.objectContaining({ name: 'Receipt queue', status: 'degraded', detail: expect.stringContaining('3 dead-letter') }));
  });
  it('reports verified empty counts without claiming worker or provider availability', async () => {
    expect(await getOperationalHealth(database({ pending: 0, processing: 0, dead_letter: 0 }))).toContainEqual(expect.objectContaining({ name: 'Receipt queue', status: 'ok', detail: expect.stringContaining('do not establish worker availability') }));
  });
});
