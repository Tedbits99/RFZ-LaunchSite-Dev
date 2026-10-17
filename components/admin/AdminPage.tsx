import { ReactNode } from 'react';

export function AdminPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main>
      <div className="mx-auto max-w-[1280px] px-5 py-8">
        <p className="mb-6 text-[10px] uppercase tracking-widest text-slate-500">{title}</p>
        {children}
      </div>
    </main>
  );
}
