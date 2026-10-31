import {
  ClipboardList,
  Home,
  Megaphone,
  Receipt,
  ShieldCheck,
  Store,
  Truck,
  Users2,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

export type NavLeaf = { label: string; href: string };
export type NavLinkItem = { label: string; href: string; icon: LucideIcon; match: string[] };
export type NavDropdownItem = { label: string; icon: LucideIcon; items: NavLeaf[] };
export type NavItem = NavLinkItem | NavDropdownItem;

export const PRIMARY_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: Home, match: ['/admin'] },
  { label: 'Orders', href: '/admin/orders', icon: Receipt, match: ['/admin/orders'] },
  {
    label: 'Products & pricing',
    icon: Store,
    items: [
      { label: 'Games & Packages', href: '/admin/games' },
      { label: 'Pricing', href: '/admin/pricing' },
      { label: 'Bulk Pricing', href: '/admin/bulk-pricing' },
      { label: 'Vouchers', href: '/admin/vouchers' },
    ],
  },
  {
    label: 'Marketing',
    icon: Megaphone,
    items: [
      { label: 'Promotions', href: '/admin/promotions' },
      { label: 'Announcements', href: '/admin/announcements' },
      { label: 'Notifications', href: '/admin/notifications' },
    ],
  },
  {
    label: 'Customers & access',
    icon: Users2,
    items: [
      { label: 'Customers', href: '/admin/customers' },
      { label: 'Staff', href: '/admin/staff' },
      { label: 'Roles & Permissions', href: '/admin/roles' },
    ],
  },
  {
    label: 'Operations',
    icon: ClipboardList,
    items: [
      { label: 'Approvals', href: '/admin/approvals' },
      { label: 'Tickets', href: '/admin/tickets' },
      { label: 'Tasks', href: '/admin/tasks' },
      { label: 'Blocklist', href: '/admin/blocklist' },
    ],
  },
  {
    label: 'Suppliers',
    icon: Truck,
    items: [
      { label: 'Suppliers', href: '/admin/suppliers' },
      { label: 'FazerCards Catalog', href: '/admin/suppliers/fazercards-catalog' },
      { label: 'Controlled Test Order', href: '/admin/suppliers/controlled-test-order' },
      { label: 'ML Offer Pricing', href: '/admin/ml-offer-pricing' },
    ],
  },
  {
    label: 'Payments & finance',
    icon: WalletCards,
    items: [
      { label: 'Payments', href: '/admin/payments' },
      { label: 'Reconciliation', href: '/admin/reconciliation' },
      { label: 'Refunds', href: '/admin/refunds' },
      { label: 'RF Coins', href: '/admin/rf-coins' },
      { label: 'Export', href: '/admin/export' },
    ],
  },
  {
    label: 'Reports & system',
    icon: ShieldCheck,
    items: [
      { label: 'Analytics', href: '/admin/analytics' },
      { label: 'Activity Log', href: '/admin/activity-log' },
      { label: 'Risk Alerts', href: '/admin/risk-alerts' },
      { label: 'System Health', href: '/admin/system-health' },
      { label: 'Security', href: '/admin/security' },
      { label: 'Settings', href: '/admin/settings' },
    ],
  },
];
