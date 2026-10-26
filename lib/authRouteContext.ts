export type AuthRouteContext = 'admin' | 'customer' | 'public' | 'service/internal' | 'mixed';

const ADMIN_EXACT_OR_PREFIX = [
  '/admin',
  '/api/admin',
  '/secure-admin-login',
];

// These APIs live outside /api/admin but call requireAdmin() in the current
// application. Keep this list explicit so a similarly named public endpoint
// cannot be classified as an admin route by accident.
const ADMIN_PROTECTED_API = [
  '/api/announcement',
  '/api/export',
  '/api/games',
  '/api/payment-config',
  '/api/promotions',
  '/api/suppliers',
  '/api/vouchers',
];

const CUSTOMER_EXACT_OR_PREFIX = [
  '/account',
  '/login',
];

const CUSTOMER_EXACT = [
  '/api/auth/register',
  '/auth/callback',
  '/auth/customer/callback',
];

const PUBLIC_EXACT_OR_PREFIX = [
  '/checkout',
  '/track-order',
];

const PUBLIC_ORDER_ROUTES = [
  '/api/orders/access',
  '/api/orders/create-payment',
  '/api/orders/create-qrph-payment',
  '/api/orders/lookup',
  '/api/orders/qrph-status',
  '/api/orders/submit-payment',
];

const SERVICE_ROUTES = [
  '/api/internal',
  '/api/webhooks/payment',
];

function isPublicOrderRoute(pathname: string): boolean {
  if (PUBLIC_ORDER_ROUTES.some((base) => isExactOrDescendant(pathname, base))) return true;
  return /^\/api\/orders\/[^/]+\/(?:status-check|timeline)$/.test(pathname);
}

function isExactOrDescendant(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

function pathnameFromInput(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '/';

  try {
    const url = new URL(trimmed, 'https://route.invalid');
    return url.pathname || '/';
  } catch {
    const withoutQuery = trimmed.split(/[?#]/, 1)[0];
    return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  }
}

/**
 * Classifies a request path for future context selection. This is routing
 * metadata only; it does not authenticate the caller or authorize a request.
 */
export function resolveAuthRouteContext(path: string): AuthRouteContext {
  const pathname = pathnameFromInput(path);

  if (
    ADMIN_EXACT_OR_PREFIX.some((base) => isExactOrDescendant(pathname, base))
    || ADMIN_PROTECTED_API.some((base) => isExactOrDescendant(pathname, base))
  ) {
    return 'admin';
  }

  if (
    CUSTOMER_EXACT_OR_PREFIX.some((base) => isExactOrDescendant(pathname, base))
    || CUSTOMER_EXACT.includes(pathname)
  ) {
    return 'customer';
  }

  if (SERVICE_ROUTES.some((base) => isExactOrDescendant(pathname, base))) {
    return 'service/internal';
  }

  if (pathname === '/api/orders' || isExactOrDescendant(pathname, '/api/orders')) {
    return isPublicOrderRoute(pathname) ? 'public' : 'mixed';
  }

  if (PUBLIC_EXACT_OR_PREFIX.some((base) => isExactOrDescendant(pathname, base))) {
    return 'public';
  }

  return 'public';
}
