import { ReactNode } from 'react';

export function AdminPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main aria-labelledby="admin-page-title">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <h1 id="admin-page-title" className="sr-only">{title}</h1>
        {children}
      </div>
    </main>
  );
}
