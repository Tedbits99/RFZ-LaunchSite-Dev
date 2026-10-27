import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

const route = vi.hoisted(() => ({ pathname: '/account/orders/ord-1' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

import AccountNavigation from './AccountNavigation';

describe('customer account navigation (SSR contract)', () => {
  it('keeps mobile chrome compact and marks the active nested route', () => {
    const html = renderToString(React.createElement(AccountNavigation));

    expect(html).toContain('lg:hidden');
    expect(html).toContain('RunFazone');
    expect(html).toContain('aria-label="Account navigation"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Open customer account"');
    expect(html).toContain('data-theme-selector');
    expect(html).not.toContain('grid-cols-2');
  });
});
