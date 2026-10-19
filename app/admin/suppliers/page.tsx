import SuppliersClient from './SuppliersClient';

export const dynamic = 'force-dynamic';

export default function AdminSuppliersPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <SuppliersClient />
    </div>
  );
}
