import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), health: vi.fn() }));
vi.mock('@/lib/adminGuard', () => ({ requireAdminPageSession: mocks.guard }));
vi.mock('@/lib/supabaseAdmin', () => ({ adminSupabase: { synthetic: true } }));
vi.mock('@/lib/operationalHealth', () => ({ getOperationalHealth: mocks.health }));
import Page from './page';
describe('direct health-page server execution', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it('does not probe privileged state when the data-boundary guard denies access', async () => {
    mocks.guard.mockRejectedValue(new Error('denied'));
    await expect(Page()).rejects.toThrow('denied');
    expect(mocks.health).not.toHaveBeenCalled();
    expect(mocks.guard).toHaveBeenCalledWith('ADMIN', 'SUPER_ADMIN');
  });
  it('queries health after administrator authorization', async () => {
    mocks.guard.mockResolvedValue({ role: 'ADMIN' });
    mocks.health.mockResolvedValue([]);
    await Page();
    expect(mocks.health).toHaveBeenCalledOnce();
  });
});
