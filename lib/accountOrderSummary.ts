export type AccountOrderForSummary = {
  payment_status: string | null;
  total_cents: number;
};

export function summarizeAccountOrders(input: {
  recentOrders: AccountOrderForSummary[];
  exactOrderCount: number | null;
  listError: boolean;
  countError: boolean;
}) {
  return {
    // The exact count is an independent owner-scoped query. A failure to load
    // the recent list must not discard a successful count (or turn it into 0).
    totalOrders: input.countError || input.exactOrderCount === null ? null : input.exactOrderCount,
    recentVerifiedPaymentCents: input.listError
      ? null
      : input.recentOrders.reduce(
        (sum, order) => sum + (order.payment_status === 'VERIFIED' ? order.total_cents : 0),
        0,
      ),
  };
}
