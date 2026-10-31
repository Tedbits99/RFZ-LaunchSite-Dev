export type AdminLoginFailureStage = 'password_auth' | 'admin_record_lookup' | 'admin_record_denied' | 'unexpected';

export type AdminLoginServices = {
  signIn(email: string, password: string): Promise<{ userId: string | null; error: unknown | null }>;
  lookupAdmin(userId: string): Promise<{
    admin: { is_active: boolean; role: string } | null;
    error: unknown | null;
  }>;
  signOutLocal(): Promise<void>;
};

export type AdminLoginResult =
  | { ok: true }
  | { ok: false; stage: AdminLoginFailureStage; error?: unknown; cleanupError?: unknown };

async function denyAndClearSession(
  services: AdminLoginServices,
  stage: 'admin_record_lookup' | 'admin_record_denied',
  error?: unknown,
): Promise<AdminLoginResult> {
  try {
    await services.signOutLocal();
    return { ok: false, stage, ...(error ? { error } : {}) };
  } catch (cleanupError) {
    return { ok: false, stage, ...(error ? { error } : {}), cleanupError };
  }
}

/** Password auth is never sufficient by itself; require the active admin row. */
export async function authenticateAdmin(
  services: AdminLoginServices,
  email: string,
  password: string,
): Promise<AdminLoginResult> {
  let userId: string | null;
  try {
    const result = await services.signIn(email, password);
    if (result.error || !result.userId) return { ok: false, stage: 'password_auth', error: result.error };
    userId = result.userId;
  } catch (error) {
    return { ok: false, stage: 'password_auth', error };
  }

  let record: Awaited<ReturnType<AdminLoginServices['lookupAdmin']>>;
  try {
    record = await services.lookupAdmin(userId);
  } catch (error) {
    return denyAndClearSession(services, 'admin_record_lookup', error);
  }
  if (record.error) return denyAndClearSession(services, 'admin_record_lookup', record.error);

  const admin = record.admin;
  if (!admin || !admin.is_active || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) {
    return denyAndClearSession(services, 'admin_record_denied');
  }

  return { ok: true };
}
