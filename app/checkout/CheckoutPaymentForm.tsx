'use client';

import { useState } from 'react';
import { Send, Loader2, CheckCircle2 } from 'lucide-react';

export default function CheckoutPaymentForm({
  orderReference,
  orderEmail,
  paymentMethod,
  totalCents,
}: {
  orderReference: string;
  orderEmail: string;
  paymentMethod: string;
  totalCents: number;
}) {
  const [referenceNumber, setReferenceNumber] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;

  const submit = async () => {
    if (!referenceNumber.trim()) {
      setError('Please enter your payment reference/transaction ID.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/orders/submit-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderReference,
          email: orderEmail,
          paymentMethod,
          referenceNumber: referenceNumber.trim(),
          note: note.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not submit payment information.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/5 p-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="text-emerald-300" size={24} />
          <div>
            <h2 className="font-display text-sm font-semibold text-emerald-300">Payment Submitted</h2>
            <p className="text-xs text-slate-400">Your payment reference has been recorded. Our team will verify it shortly.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-6">
      <h2 className="font-display text-sm font-semibold">Submit Payment Proof</h2>
      <p className="mt-1 text-xs text-slate-500">Enter your transaction reference so we can verify your payment.</p>
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Payment Reference / Transaction ID *</span>
          <input
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            placeholder="e.g. TXN123456789"
            className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2.5 text-sm outline-none focus:border-cyan-400"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Note (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Add any notes about your payment"
            className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2.5 text-sm outline-none focus:border-cyan-400"
          />
        </label>
        <div className="flex items-center justify-between rounded-lg border border-[#1b2a45] px-3 py-2 text-xs">
          <span className="text-slate-500">Amount to pay</span>
          <span className="font-display font-bold text-cyan-300">{fmtP(totalCents)}</span>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          onClick={submit}
          disabled={submitting || !referenceNumber.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 py-3 text-sm font-semibold disabled:opacity-40"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={14} />}
          {submitting ? 'Submitting...' : 'Submit Payment'}
        </button>
      </div>
    </div>
  );
}
