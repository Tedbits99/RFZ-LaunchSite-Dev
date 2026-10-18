type ConfirmationPageProps = {
  searchParams?: { status?: string };
};

const messages: Record<string, { title: string; detail: string }> = {
  success: {
    title: 'Email confirmed',
    detail: 'Your customer account is ready. You can return to the store.',
  },
  pending: {
    title: 'Account still pending',
    detail: 'This account is not ready for access yet. Request a fresh confirmation email if needed.',
  },
  restricted: {
    title: 'Account access restricted',
    detail: 'This confirmation link cannot change the current account status.',
  },
  invalid: {
    title: 'Confirmation link unavailable',
    detail: 'This link is invalid, expired, or has already been used.',
  },
  error: {
    title: 'Confirmation unavailable',
    detail: 'We could not complete confirmation right now. Please try again later.',
  },
};

export default function ConfirmationPage({ searchParams }: ConfirmationPageProps) {
  const message = messages[searchParams?.status || 'error'] || messages.error;
  return (
    <main className="min-h-screen bg-[#030718] px-5 py-20 text-slate-100">
      <div className="mx-auto max-w-lg rounded-xl border border-[#1b2a45] bg-[#0b1225] p-8 text-center">
        <h1 className="font-display text-2xl font-bold">{message.title}</h1>
        <p className="mt-3 text-sm text-slate-400">{message.detail}</p>
        <a href="/" className="mt-6 inline-block rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-200">Return to store</a>
      </div>
    </main>
  );
}
