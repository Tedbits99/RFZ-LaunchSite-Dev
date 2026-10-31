export const ADMIN_PERMISSION_CATALOG = [
  { key: 'orders.view', label: 'View orders', area: 'Orders' },
  { key: 'orders.edit', label: 'Edit order status', area: 'Orders' },
  { key: 'orders.refund', label: 'Manage refunds', area: 'Orders' },
  { key: 'games.manage', label: 'Manage games and packages', area: 'Catalog' },
  { key: 'pricing.manage', label: 'Manage catalog pricing', area: 'Catalog' },
  { key: 'customers.view', label: 'View customers', area: 'Customers' },
  { key: 'customers.manage', label: 'Manage customer access', area: 'Customers' },
  { key: 'payments.view', label: 'View payment configuration', area: 'Payments' },
  { key: 'payments.manage', label: 'Manage payment methods', area: 'Payments' },
  { key: 'payments.refund', label: 'Manage payment refunds', area: 'Payments' },
  { key: 'staff.manage', label: 'Manage staff membership', area: 'Access' },
  { key: 'tickets.manage', label: 'Manage support tickets', area: 'Operations' },
  { key: 'tasks.manage', label: 'Manage admin tasks', area: 'Operations' },
  { key: 'analytics.view', label: 'View analytics', area: 'Reports' },
  { key: 'marketing.manage', label: 'Manage promotions and announcements', area: 'Marketing' },
  { key: 'suppliers.view', label: 'View supplier configuration', area: 'Suppliers' },
  { key: 'suppliers.manage', label: 'Manage supplier catalog configuration', area: 'Suppliers' },
  { key: 'settings.manage', label: 'Manage business settings', area: 'System' },
  { key: 'system.view', label: 'View runtime diagnostics', area: 'System' },
] as const

export type AdminPermissionKey = typeof ADMIN_PERMISSION_CATALOG[number]['key']

export function isAdminPermissionKey(value: unknown): value is AdminPermissionKey {
  return typeof value === 'string' && ADMIN_PERMISSION_CATALOG.some((permission) => permission.key === value)
}
