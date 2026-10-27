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
  const ordersUnavailable = input.listError || input.countError;
  return {
    totalOrders: ordersUnavailable || input.exactOrderCount === null ? null : input.exactOrderCount,
    recentVerifiedPaymentCents: input.listError
      ? null
      : input.recentOrders.reduce(
        (sum, order) => sum + (order.payment_status === 'VERIFIED' ? order.total_cents : 0),
        0,
      ),
  };
}
