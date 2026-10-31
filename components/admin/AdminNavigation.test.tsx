import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/rf-coins' }));

import AdminNavigation from './AdminNavigation';

describe('admin mobile navigation state', () => {
  it('moves the drawer onscreen when opened, independent of utility-class cascade order', () => {
    const html = renderToString(React.createElement(AdminNavigation, {
      open: true,
      onClose: () => undefined,
      role: 'SUPER_ADMIN',
    }));

    expect(html).toContain('style="transform:translateX(0)"');
    expect(html).toContain('aria-label="Close admin navigation"');
    expect(html).toContain('Payments &amp; finance');
  });

  it('keeps the drawer offscreen until explicitly opened', () => {
    const html = renderToString(React.createElement(AdminNavigation, {
      open: false,
      onClose: () => undefined,
      role: 'SUPER_ADMIN',
    }));

    expect(html).toContain('class="rfz-admin-nav');
    expect(html).toContain('-translate-x-full');
    expect(html).not.toContain('style="transform:translateX(0)"');
  });
});
