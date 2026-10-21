export type OrderStatusPresentation = {
  label: string;
  tone: string;
  message: string;
  terminal: boolean;
};

const PRESENTATIONS: Record<string, OrderStatusPresentation> = {
  PENDING: { label: 'Order received', tone: 'text-slate-300 border-slate-500/40 bg-slate-500/10', message: 'We received your order.', terminal: false },
  WAITING_PAYMENT: { label: 'Waiting for payment', tone: 'text-amber-300 border-amber-400/40 bg-amber-400/10', message: 'Complete payment to start fulfillment.', terminal: false },
  PAID: { label: 'Payment confirmed', tone: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10', message: 'Payment confirmed. Fulfillment is next.', terminal: false },
  PROCESSING: { label: 'Processing', tone: 'text-cyan-300 border-cyan-400/40 bg-cyan-400/10', message: 'Your order is being fulfilled.', terminal: false },
  COMPLETED: { label: 'Completed', tone: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10', message: 'Your order was fulfilled.', terminal: true },
  DELIVERED: { label: 'Delivered', tone: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10', message: 'Your item was delivered.', terminal: true },
  FAILED: { label: 'Failed', tone: 'text-rose-300 border-rose-400/40 bg-rose-400/10', message: 'We could not complete this order. Contact support for help.', terminal: true },
  FULFILLMENT_FAILED: { label: 'Fulfillment failed', tone: 'text-rose-300 border-rose-400/40 bg-rose-400/10', message: 'Fulfillment needs support review.', terminal: true },
  EXPIRED: { label: 'Expired', tone: 'text-slate-400 border-slate-500/40 bg-slate-500/10', message: 'This payment window expired.', terminal: true },
  CANCELLED: { label: 'Cancelled', tone: 'text-slate-400 border-slate-500/40 bg-slate-500/10', message: 'This order was cancelled.', terminal: true },
  REFUND_PENDING: { label: 'Refund pending', tone: 'text-amber-300 border-amber-400/40 bg-amber-400/10', message: 'Your refund is being processed.', terminal: false },
  REFUNDED: { label: 'Refunded', tone: 'text-cyan-300 border-cyan-400/40 bg-cyan-400/10', message: 'Your refund is complete.', terminal: true },
};

export function getOrderPresentation(status: string): OrderStatusPresentation {
  return PRESENTATIONS[status] || { label: 'Status unavailable', tone: 'text-slate-400 border-slate-500/40 bg-slate-500/10', message: 'We are checking the latest order status.', terminal: false };
}
