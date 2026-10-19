import FazerCardsCatalogClient from './FazerCardsCatalogClient';

export const dynamic = 'force-dynamic';

export default function FazerCardsCatalogPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <FazerCardsCatalogClient />
    </div>
  );
}
