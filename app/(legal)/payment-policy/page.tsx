export const metadata = { title: 'Payment & Delivery Policy | RunFazone' };

export default function PaymentPolicy() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold">Payment &amp; Delivery Policy</h1>
      <p className="mt-2 text-xs text-slate-500">Effective: October 12, 2026 &middot; Last updated: October 12, 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-7 text-slate-300">
        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">1. Payment Methods</h2>
          <p className="mt-2">RunFazone offers the payment methods displayed on our checkout page. These may include manual payment methods (such as bank transfer, GCash, or Maya) and automated payment methods (such as QR Ph). The availability of specific methods may change over time.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">2. Manual Payment Process</h2>
          <p className="mt-2">For manual payment methods, the checkout page displays the payment instructions, including the account name, account number, and any QR code you need to scan. After sending your payment, you must submit your payment reference number or proof of payment through the checkout page so our team can verify it.</p>
          <p className="mt-2">Your order status will show as &ldquo;Waiting for Payment&rdquo; until your payment is verified. Once verified, the status changes and processing begins.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">3. Automated Payment Process (QR Ph)</h2>
          <p className="mt-2">For QR Ph payments, a QR code is generated on the checkout page. Scan the QR code using your supported banking or e-wallet app to complete the payment. Our payment system automatically verifies the payment and updates the order status, so no manual payment reference submission is needed.</p>
          <p className="mt-2">If the payment is not completed within the applicable time limit, the payment attempt may expire, and you may need to initiate a new payment.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">4. Payment Verification</h2>
          <p className="mt-2">For manual payments, our team verifies each payment reference before processing begins. This is a manual review process and may take some time depending on order volume. For automated payments, verification is handled by the payment provider and is typically faster.</p>
          <p className="mt-2">We reserve the right to request additional payment proof or to hold processing if a payment cannot be confirmed or appears suspicious.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">5. Fulfillment Process</h2>
          <p className="mt-2">After payment verification, your order is forwarded to our supplier for fulfillment. The supplier processes the top-up and delivers the credits or items to the game account identified by the Player ID, User ID, Server ID, Zone ID, or UID you provided at checkout.</p>
          <p className="mt-2">You can track the status of your order in real time using the Track Order page with your order reference and email.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">6. Delivery Times</h2>
          <p className="mt-2">Delivery times vary depending on the game, package, payment method, supplier availability, and order volume. We do not promise or guarantee any specific delivery timeframe. Orders are processed almost instantly after payment verification, but delays can occur due to factors outside our control, including supplier maintenance, game server downtime, or high demand.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">7. Order Status Notifications</h2>
          <p className="mt-2">You can always check your order status on the Track Order page. The page updates automatically to reflect the latest status, including payment verification, processing, completion, or any issues encountered.</p>
        </section>
      </div>
    </>
  );
}
