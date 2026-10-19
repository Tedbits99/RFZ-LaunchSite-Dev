export const metadata = { title: 'Refund & Cancellation Policy | RunFazone' };

export default function RefundPolicy() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold">Refund &amp; Cancellation Policy</h1>
      <p className="mt-2 text-xs text-slate-500">Effective: October 12, 2026 &middot; Last updated: October 12, 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-7 text-slate-300">
        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">1. Overview</h2>
          <p className="mt-2">We want every order to be delivered successfully. If something goes wrong, this policy explains how to report the issue and how we review refund and cancellation requests.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">2. Failed Orders</h2>
          <p className="mt-2">If your top-up fails to deliver after payment has been verified and processing is complete, you can report the issue through the Contact section on our homepage or the Track Order page. Please include your order reference number and a description of the problem.</p>
          <p className="mt-2">We will investigate the issue with our supplier. If the order cannot be fulfilled, you will receive a full refund of the amount you paid.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">3. Delayed Orders</h2>
          <p className="mt-2">Delivery times can vary and are not guaranteed. If your order is taking longer than expected, you can check its status on the Track Order page. If the order remains unfulfilled after a reasonable period, contact us and we will investigate and provide an update or a refund if appropriate.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">4. Duplicate Orders</h2>
          <p className="mt-2">If you accidentally place the same order twice and both are paid, contact us with both order reference numbers. We will review the orders and, if the duplicate has not been fulfilled, we will refund the duplicate payment.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">5. Incorrectly Delivered Orders</h2>
          <p className="mt-2">If your top-up is delivered to the wrong account due to an error on our end, contact us immediately with your order reference and the correct player details. We will work to resolve the issue by either re-delivering to the correct account or issuing a refund.</p>
          <p className="mt-2">If delivery went to the wrong account because you provided incorrect Player ID, User ID, Server ID, Zone ID, or UID, we are not able to guarantee a refund, as we fulfill based on the information you submitted. However, we will still investigate and assist where possible.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">6. Cancellation Before Payment</h2>
          <p className="mt-2">You can cancel an order at any time before payment is submitted. Simply do not proceed with payment and the order will expire automatically.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">7. Cancellation After Payment</h2>
          <p className="mt-2">Once payment is verified and order processing has begun, cancellation may not be possible if fulfillment has already been submitted to our supplier. Contact us as soon as possible and we will attempt to cancel the order before it is fulfilled. If cancellation is successful, a full refund will be issued.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">8. How Refunds Are Processed</h2>
          <p className="mt-2">Approved refunds are returned to the original payment method used for the order. The time it takes for the refund to appear depends on your payment provider and may take several business days.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">9. How to Report an Issue</h2>
          <p className="mt-2">To report a failed, delayed, duplicate, or incorrectly delivered order, contact us through the Contact section on our homepage. Please provide your order reference number, email address used at checkout, and a clear description of the issue.</p>
        </section>
      </div>
    </>
  );
}
