import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderCompletionReceipt, type CompletionReceiptInput } from './completionReceipt';

const fixture: CompletionReceiptInput = {
  publicOrderReference: 'RF-ABC123',
  gameName: 'Mobile Legends',
  packageName: '86 Diamonds',
  quantity: 2,
  playerIdentifier: '108570999',
  paymentMethod: 'gcash',
  totalCents: 12345,
  completedAt: '2026-10-17T19:00:00.000Z',
};

describe('completion receipt renderer', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://runfazone.com';
    vi.unstubAllGlobals();
  });

  it('returns the approved subject and HTML/text receipt', () => {
    const receipt = renderCompletionReceipt(fixture);

    expect(receipt.subject).toBe('Top-Up Successful — RF-ABC123');
    expect(receipt.html).toContain('Top-Up Successful');
    expect(receipt.html).toContain('#030718');
    expect(receipt.html).toContain('#0b1226');
    expect(receipt.html).toContain('#18c8ff');
    expect(receipt.html).toContain('#2563eb');
    expect(receipt.html).toContain('#7c3aed');
    expect(receipt.html).toContain('#15803d');
    expect(receipt.html).toContain('#dbe4ef');
    expect(receipt.html).toContain('#0f172a');
    expect(receipt.html).toContain('RF-ABC123');
    expect(receipt.text).toContain('Top-Up Successful');
    expect(receipt.text).toContain('RF-ABC123');
  });

  it('formats authoritative cents as PHP and completion time in Manila', () => {
    const receipt = renderCompletionReceipt(fixture);

    expect(receipt.html).toContain('₱123.45');
    expect(receipt.text).toContain('₱123.45');
    expect(receipt.html).toContain('October 18, 2026');
    expect(receipt.text).toContain('October 18, 2026');
    expect(receipt.html).toContain('GCash');
    expect(receipt.text).toContain('GCash');
  });

  it('masks the player identifier and keeps HTML/text fields aligned', () => {
    const receipt = renderCompletionReceipt(fixture);

    expect(receipt.html).toContain('*****0999');
    expect(receipt.text).toContain('*****0999');
    expect(receipt.html).not.toContain(fixture.playerIdentifier);
    expect(receipt.text).not.toContain(fixture.playerIdentifier);
    for (const value of ['Mobile Legends', '86 Diamonds', 'Quantity: 2', 'orders@runfazone.com']) {
      expect(receipt.text).toContain(value);
    }
  });

  it('renders a consistent branded transactional footer in HTML and text', () => {
    const receipt = renderCompletionReceipt(fixture);
    const footerLines = [
      'RunFazone',
      'This is a transactional top-up completion receipt.',
      'orders@runfazone.com',
      '© 2026 RunFazone. All rights reserved.',
    ];

    for (const line of footerLines) {
      expect(receipt.html).toContain(line);
      expect(receipt.text).toContain(line);
    }
    expect(receipt.html).toContain('background:#0b1226');
    expect(receipt.html).not.toContain('unsubscribe');
    expect(receipt.html).not.toContain('tracking');
  });

  it('escapes dynamic HTML values and uses a fixed-origin tracking CTA', () => {
    const receipt = renderCompletionReceipt({
      ...fixture,
      gameName: 'A & B <Game>',
      packageName: '"Special" Pack',
    });

    expect(receipt.html).toContain('A &amp; B &lt;Game&gt;');
    expect(receipt.html).toContain('&quot;Special&quot; Pack');
    expect(receipt.html).toContain('https://runfazone.com/track-order?ref=RF-ABC123');
    expect(receipt.html).not.toContain('javascript:');
    expect(receipt.html).not.toContain('runfazone.com@');
  });

  it('rejects missing or invalid required fields and origin configuration', () => {
    expect(() => renderCompletionReceipt({ ...fixture, gameName: '' })).toThrow();
    expect(() => renderCompletionReceipt({ ...fixture, publicOrderReference: 'RF-<123' })).toThrow();
    expect(() => renderCompletionReceipt({ ...fixture, quantity: 0 })).toThrow();
    expect(() => renderCompletionReceipt({ ...fixture, totalCents: -1 })).toThrow();
    expect(() => renderCompletionReceipt({ ...fixture, completedAt: 'not-a-date' })).toThrow();

    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(() => renderCompletionReceipt(fixture)).toThrow();
  });

  it('contains no tokens, identifiers, scripts, pixels, or remote fonts', () => {
    const receipt = renderCompletionReceipt(fixture);
    const combined = `${receipt.html}\n${receipt.text}`;

    expect(combined).not.toContain('00000000-0000');
    expect(combined).not.toContain('capability');
    expect(combined).not.toContain('supplier');
    expect(combined).not.toContain('token');
    expect(combined).not.toContain('<script');
    expect(combined).not.toContain('<img');
    expect(combined).not.toContain('http://fonts');
    expect(combined).not.toContain('https://fonts');
  });

  it('supports long catalog values without dropping the required fields', () => {
    const receipt = renderCompletionReceipt({
      ...fixture,
      gameName: 'G'.repeat(100),
      packageName: 'P'.repeat(100),
      quantity: 1,
    });

    expect(receipt.html).toContain('G'.repeat(100));
    expect(receipt.text).toContain('P'.repeat(100));
    expect(receipt.html).toContain('max-width:600px');
    expect(receipt.html).toContain('font-family:Arial,Helvetica,sans-serif');
  });

  it('does not perform network or cookie operations', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const receipt = renderCompletionReceipt(fixture);
    expect(receipt.html).toBeTruthy();
    expect(receipt.text).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
