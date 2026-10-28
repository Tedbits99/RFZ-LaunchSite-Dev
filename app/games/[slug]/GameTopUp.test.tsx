import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import GameTopUp from './GameTopUp';

const GAME_SLUGS = [
  'mobile-legends',
  'pubg-mobile',
  'free-fire',
  'genshin-impact',
  'valorant',
  'honor-of-kings',
  'roblox',
  'call-of-duty-mobile',
] as const;

const ENABLED_METHODS = [
  { method_key: 'gcash', display_name: 'GCash', is_enabled: true, logo_url: null },
  { method_key: 'maya', display_name: 'Maya', is_enabled: true, logo_url: null },
  { method_key: 'coinsph', display_name: 'Coins.ph', is_enabled: true, logo_url: null },
  { method_key: 'paymongo_qrph', display_name: 'PayMongo QR Ph', is_enabled: true, logo_url: null },
];

function renderGameStore(slug: string, methods = ENABLED_METHODS) {
  return renderToStaticMarkup(React.createElement(GameTopUp, {
    game: {
      id: `game-${slug}`,
      slug,
      name: slug,
      description: 'Synthetic game store',
      region: 'Global',
      currency: 'PHP',
    },
    fields: [],
    packages: [{
      id: `package-${slug}`,
      name: 'Synthetic package',
      amount: '100',
      price_cents: 10000,
      original_price_cents: null,
      bonus: null,
    }],
    dbPaymentMethods: methods,
    paymentConfigAuthoritative: true,
  }));
}

describe('payment methods across the eight game stores', () => {
  it.each(GAME_SLUGS)('renders only configured product payment methods for %s', (slug) => {
    const html = renderGameStore(slug);

    expect(html).toContain('Payment Methods');
    expect(html).toContain('role="radiogroup" aria-label="Payment methods"');
    for (const method of ENABLED_METHODS) {
      expect(html).toContain(`value="${method.method_key}"`);
      expect(html).toContain(method.display_name);
    }
    expect(html).not.toContain('RF Coins Wallet');
  });

  it('fails closed when the payment configuration query has no usable methods', () => {
    const html = renderGameStore('pubg-mobile', []);

    expect(html).toContain('No payment methods are currently available');
    expect(html).not.toContain('value="gcash"');
    expect(html).not.toContain('value="paymongo_qrph"');
  });

  it('does not advertise disabled database methods', () => {
    const html = renderGameStore('free-fire', [
      ...ENABLED_METHODS,
      { method_key: 'disabled-test', display_name: 'Disabled test method', is_enabled: false, logo_url: null },
    ]);

    expect(html).not.toContain('value="disabled-test"');
    expect(html).not.toContain('Disabled test method');
  });
});
