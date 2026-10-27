import { describe, expect, it, vi } from 'vitest';
import { authenticateAdmin, type AdminLoginServices } from './adminLoginFlow';

function services(overrides: Partial<AdminLoginServices> = {}): AdminLoginServices {
  return {
    signIn: vi.fn().mockResolvedValue({ userId: 'admin-1', error: null }),
    lookupAdmin: vi.fn().mockResolvedValue({ admin: { is_active: true, role: 'ADMIN' }, error: null }),
    signOutLocal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('admin password login flow', () => {
  it('accepts only a valid password session mapped to an active ADMIN or SUPER_ADMIN row', async () => {
    const client = services();
    await expect(authenticateAdmin(client, 'admin@example.test', 'synthetic-password')).resolves.toEqual({ ok: true });
    expect(client.lookupAdmin).toHaveBeenCalledWith('admin-1');
    expect(client.signOutLocal).not.toHaveBeenCalled();
  });

  it('classifies rejected credentials separately without querying the admin table', async () => {
    const client = services({ signIn: vi.fn().mockResolvedValue({ userId: null, error: { status: 400 } }) });
    const result = await authenticateAdmin(client, 'admin@example.test', 'wrong-synthetic-password');
    expect(result).toMatchObject({ ok: false, stage: 'password_auth' });
    expect(client.lookupAdmin).not.toHaveBeenCalled();
  });

  it('clears a valid Auth session when the admin SELECT fails', async () => {
    const client = services({ lookupAdmin: vi.fn().mockResolvedValue({ admin: null, error: { status: 403, code: '42501' } }) });
    const result = await authenticateAdmin(client, 'admin@example.test', 'synthetic-password');
    expect(result).toMatchObject({ ok: false, stage: 'admin_record_lookup' });
    expect(client.signOutLocal).toHaveBeenCalledOnce();
  });

  it.each([
    ['inactive', { is_active: false, role: 'SUPER_ADMIN' }],
    ['non-admin role', { is_active: true, role: 'CUSTOMER' }],
  ])('clears a valid Auth session for an %s record', async (_label, admin) => {
    const client = services({ lookupAdmin: vi.fn().mockResolvedValue({ admin, error: null }) });
    const result = await authenticateAdmin(client, 'admin@example.test', 'synthetic-password');
    expect(result).toMatchObject({ ok: false, stage: 'admin_record_denied' });
    expect(client.signOutLocal).toHaveBeenCalledOnce();
  });

  it('returns a bounded failure instead of hanging if an auth operation rejects', async () => {
    const client = services({ signIn: vi.fn().mockRejectedValue(new Error('synthetic network failure')) });
    const result = await authenticateAdmin(client, 'admin@example.test', 'synthetic-password');
    expect(result).toMatchObject({ ok: false, stage: 'password_auth' });
    expect(client.lookupAdmin).not.toHaveBeenCalled();
  });

  it('records local cleanup failure without accepting the administrator', async () => {
    const client = services({
      lookupAdmin: vi.fn().mockResolvedValue({ admin: null, error: { status: 403 } }),
      signOutLocal: vi.fn().mockRejectedValue(new Error('synthetic sign-out failure')),
    });
    const result = await authenticateAdmin(client, 'admin@example.test', 'synthetic-password');
    expect(result).toMatchObject({ ok: false, stage: 'admin_record_lookup', cleanupError: expect.any(Error) });
  });
});
