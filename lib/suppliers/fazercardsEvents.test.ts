import { describe, expect, it } from 'vitest';
import { categorizeFazerCardsEvent, titleForFazerCardsEvent, summarizeFazerCardsStatus } from './fazercardsEvents';

describe('FazerCards documented order notification categories', () => {
  it('shows a separate category for newly created supplier orders', () => {
    expect(categorizeFazerCardsEvent('order.created')).toBe('created');
    expect(titleForFazerCardsEvent('order.created')).toBe('New supplier order');
  });
  it('shows a separate category and transition for order status changes', () => {
    expect(categorizeFazerCardsEvent('order.status_changed')).toBe('status');
    expect(titleForFazerCardsEvent('order.status_changed')).toBe('Supplier order status changed');
    expect(summarizeFazerCardsStatus('processing', 'completed')).toBe('processing → completed');
    expect(summarizeFazerCardsStatus(null, 'failed')).toBe('failed');
    expect(summarizeFazerCardsStatus('processing', 'processing')).toBe('processing');
  });
  it('does not count chat and test events as new orders or status changes', () => {
    expect(categorizeFazerCardsEvent('manual_service.chat.message')).toBe('chat');
    expect(categorizeFazerCardsEvent('manual_service.chat.waiting_reply')).toBe('chat');
    expect(categorizeFazerCardsEvent('webhook.test')).toBe('other');
    expect(titleForFazerCardsEvent('webhook.test')).toBe('FazerCards webhook test');
  });
});
