/** Categories in FazerCards' documented webhook contract. */
export type FazerCardsEventCategory = 'created' | 'status' | 'chat' | 'other';

export function categorizeFazerCardsEvent(eventType: string): FazerCardsEventCategory {
  if (eventType === 'order.created') return 'created';
  if (eventType === 'order.status_changed') return 'status';
  if (eventType.startsWith('manual_service.chat.')) return 'chat';
  return 'other';
}

export function titleForFazerCardsEvent(eventType: string): string {
  switch (categorizeFazerCardsEvent(eventType)) {
    case 'created': return 'New supplier order';
    case 'status': return 'Supplier order status changed';
    case 'chat': return 'Supplier chat notification';
    default: return eventType === 'webhook.test' ? 'FazerCards webhook test' : 'Supplier event';
  }
}

export function summarizeFazerCardsStatus(previous: string | null, current: string | null): string | null {
  if (previous && current && previous !== current) return `${previous} → ${current}`;
  return current || previous;
}
