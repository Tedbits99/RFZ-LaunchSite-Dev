export const metadata = { title: 'Privacy Policy | RunFazone' };

export default function PrivacyPolicy() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-xs text-slate-500">Effective: October 12, 2026 &middot; Last updated: October 12, 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-7 text-slate-300">
        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">1. Information We Collect</h2>
          <p className="mt-2">When you place an order on RunFazone, we collect the following information:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
            <li><span className="text-slate-300">Email address</span> &mdash; used to send you order confirmations, status updates, and to allow you to track your order.</li>
            <li><span className="text-slate-300">Customer name</span> &mdash; optionally provided at checkout for order records.</li>
            <li><span className="text-slate-300">Player identification details</span> &mdash; such as Player ID, User ID, Server ID, Zone ID, or UID, which are required to deliver your top-up to the correct game account.</li>
            <li><span className="text-slate-300">Payment method and payment reference</span> &mdash; the method you selected and any reference number or proof you submit so we can verify your payment.</li>
            <li><span className="text-slate-300">Order details</span> &mdash; the game, package, amount, and order reference number associated with your purchase.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">2. How We Use Your Information</h2>
          <p className="mt-2">Your information is used solely for the following purposes:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
            <li>Processing and fulfilling your top-up orders.</li>
            <li>Verifying your payment and confirming your order status.</li>
            <li>Allowing you to track your order through the Track Order page.</li>
            <li>Communicating with you about your order if issues arise.</li>
            <li>Improving our service and preventing fraud or abuse.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">3. How Your Information Is Handled</h2>
          <p className="mt-2">Your order data is stored securely using our database provider. Access to your data is restricted by row-level security policies so that only you (via your order reference and email) and authorized administrators can view your order information.</p>
          <p className="mt-2">Payment is processed through our configured payment providers. We do not store your full payment card numbers or banking credentials. For automated payments via QR Ph, the payment provider handles the transaction and sends us a confirmation. For manual payments, we only store the payment reference or proof you submit.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">4. Service Providers</h2>
          <p className="mt-2">We rely on the following types of third-party service providers to operate:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
            <li><span className="text-slate-300">Database and Authentication Services</span> &mdash; to store and manage information and support account-related functionality.</li>
            <li><span className="text-slate-300">Payment Services</span> &mdash; to process payments and verify transactions, including automated QR Ph payments where available.</li>
            <li><span className="text-slate-300">Game Top-Up Suppliers</span> &mdash; to process and fulfill orders for in-game credits or items.</li>
            <li><span className="text-slate-300">Hosting and Technical Services</span> &mdash; to maintain website availability, security, and performance where applicable.</li>
          </ul>
          <p className="mt-2">These service providers may process information as necessary to perform their respective services. We limit information sharing to what is reasonably necessary for order processing, payment verification, website operation, security, and other legitimate business purposes, subject to applicable law.</p>
          <p className="mt-2">Third-party service providers may have their own privacy policies and data-handling practices.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">5. Data Retention</h2>
          <p className="mt-2">We retain your order records for as long as necessary to provide our service, resolve disputes, and comply with legal obligations. Older orders may be archived but remain accessible for reference.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">6. Your Rights</h2>
          <p className="mt-2">You have the right to request access to or correction of your personal information. You can contact us through the Contact section on our homepage to exercise these rights.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">7. Cookies and Tracking</h2>
          <p className="mt-2">RunFazone uses essential cookies for authentication and session management when you create an account or sign in. We do not use third-party advertising or analytics tracking cookies at this time.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-slate-100">8. Changes to This Policy</h2>
          <p className="mt-2">We may update this Privacy Policy from time to time. The most current version will always be available on this page with the updated date.</p>
        </section>
      </div>
    </>
  );
}
