export type PaymentResult = { success: boolean; providerReference?: string; checkoutUrl?: string; error?: string };
export type VerifyResult = { paid: boolean; providerReference?: string; error?: string };
export type WebhookResult = { orderId?: string; status: string; raw: unknown };

export interface PaymentProvider {
  name: string;
  createPayment(order: { reference: string; totalCents: number; email: string }): Promise<PaymentResult>;
  verifyPayment(providerReference: string): Promise<VerifyResult>;
  handleWebhook(req: Request): Promise<WebhookResult>;
  refundPayment(providerReference: string, amountCents: number): Promise<PaymentResult>;
}

export class MockPaymentProvider implements PaymentProvider {
  name = 'mock';
  async createPayment(order: { reference: string; totalCents: number; email: string }): Promise<PaymentResult> {
    return { success: true, providerReference: `MOCK-${order.reference}`, checkoutUrl: `/checkout/mock?ref=${order.reference}` };
  }
  async verifyPayment(providerReference: string): Promise<VerifyResult> {
    return { paid: providerReference.startsWith('MOCK-'), providerReference };
  }
  async handleWebhook(req: Request): Promise<WebhookResult> {
    const body = await req.json();
    return { orderId: body.orderId, status: body.status || 'PAID', raw: body };
  }
  async refundPayment(providerReference: string): Promise<PaymentResult> {
    return { success: true, providerReference };
  }
}

export function getPaymentProvider(): PaymentProvider {
  const configured = process.env.PAYMENT_PROVIDER || 'mock';
  if (configured === 'mock' || !configured) return new MockPaymentProvider();
  return new MockPaymentProvider();
}
