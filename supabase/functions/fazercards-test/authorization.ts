export type AdminAccess = { role: string; is_active: boolean } | null;

export function isActiveAdmin(admin: AdminAccess): admin is { role: string; is_active: true } {
  return Boolean(admin?.is_active);
}

export function mayCreateSupplierOrder(admin: AdminAccess): boolean {
  return isActiveAdmin(admin) && admin.role === 'SUPER_ADMIN';
}

export function mayUseServiceCredential(isOrderRequest: boolean): boolean {
  return !isOrderRequest;
}
