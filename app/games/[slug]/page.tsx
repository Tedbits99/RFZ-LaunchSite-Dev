import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { notFound } from 'next/navigation';
import GameTopUp from './GameTopUp';

export const dynamic = 'force-dynamic';

type CustomerPackage = {
  id: string;
  name: string;
  amount: string;
  price_cents: number;
  original_price_cents: number | null;
  bonus: string | null;
  sort_order: number;
  badge: string | null;
  image_url: string | null;
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!supabase) return { title: 'Game Top-Up | RunFazone' };
  const { data } = await supabase.from('games').select('name, description').eq('slug', slug).maybeSingle();
  return { title: data ? `${data.name} Top-Up | RunFazone` : 'Game Top-Up | RunFazone', description: data?.description || 'Top up your favorite game with RunFazone.' };
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!supabase) return <div className="grid min-h-screen place-items-center bg-[#030718] text-slate-400">Database not configured.</div>;
  const { data: game } = await supabase.from('games')
    .select('id, slug, name, description, region, currency, banner_url, logo_url')
    .eq('slug', slug)
    .eq('is_active', true)
    .eq('catalog_status', 'PUBLISHED')
    .maybeSingle();
  if (!game) notFound();
  const { data: fields } = await supabase.from('game_input_fields').select('*').eq('game_id', game.id).order('sort_order');
  const { data: packages } = await supabase
    .from('packages')
    .select('id, name, amount, price_cents, original_price_cents, bonus, sort_order, badge, image_url')
    .eq('game_id', game.id)
    .eq('is_active', true)
    .eq('catalog_status', 'PUBLISHED')
    .gt('price_cents', 0)
    .order('sort_order');
  const { data: payConfigs } = await supabase.from('payment_config').select('method_key, display_name, is_enabled, logo_url').eq('is_enabled', true).order('sort_order');

  let detailBannerUrl: string | null = null;
  const { data: detailPromo } = await supabase
    .from('promotions')
    .select('image_url')
    .eq('is_active', true)
    .eq('placement', 'GAME_DETAIL_HERO')
    .eq('target_game_id', game.id)
    .order('sort_order')
    .limit(1)
    .maybeSingle();
  if (detailPromo?.image_url) detailBannerUrl = detailPromo.image_url;

  const packageRecords = packages || [];
  const isSpecialPackage = (pkg: (typeof packageRecords)[number]) => {
    const normalizedName = pkg.name.toLowerCase();
    return normalizedName === 'weekly diamond pass' || normalizedName === 'twilight pass' || normalizedName.includes('first top-up bonus');
  };
  let customerPackages: CustomerPackage[] = packageRecords;
  if (game.slug === 'mobile-legends' || game.slug === 'mlbb') {
    // Supplier mappings and offer identifiers are internal configuration.
    // Read them only with the server-side service client; never ask the public
    // catalog key for those columns or pass them to the browser.
    const { data: supplierPackages, error: supplierPackagesError } = adminSupabase && packageRecords.length
      ? await adminSupabase.from('packages')
        .select('id, supplier_offer_id, supplier_category_id')
        .in('id', packageRecords.map((pkg) => pkg.id))
      : { data: [], error: null };
    const supplierPackageById = new Map(
      (supplierPackages || []).map((pkg) => [pkg.id, pkg]),
    );
    const customerPackageById = new Map(packageRecords.map((pkg) => [pkg.id, pkg]));
    const { data: supplier } = adminSupabase
      ? await adminSupabase
      .from('suppliers')
      .select('id')
      .eq('code', 'fazercards')
      .eq('enabled', true)
      .maybeSingle()
      : { data: null };

    if (supplier && adminSupabase && !supplierPackagesError) {
      const { data: mappings } = await adminSupabase
        .from('supplier_package_mappings')
        .select('package_id, supplier_product_id, metadata')
        .eq('supplier_id', supplier.id)
        .eq('enabled', true)
        .not('supplier_product_id', 'is', null);
      const validMappingPackageIds = new Set(
        (mappings || [])
          .filter((mapping) => {
            const pkg = supplierPackageById.get(mapping.package_id);
            const metadata = mapping.metadata as { category_id?: string } | null;
            return pkg?.supplier_category_id === 'mobile_legends_philippines'
              && Boolean(pkg.supplier_offer_id)
              && mapping.supplier_product_id === pkg.supplier_offer_id
              && metadata?.category_id === 'mobile_legends_philippines';
          })
          .map((mapping) => mapping.package_id),
      );
      customerPackages = customerPackages.filter((pkg) => {
        const customerPackage = customerPackageById.get(pkg.id);
        return customerPackage ? isSpecialPackage(customerPackage) || validMappingPackageIds.has(pkg.id) : false;
      });
    } else {
      customerPackages = customerPackages.filter((pkg) => {
        const packageRecord = packageRecords.find((candidate) => candidate.id === pkg.id);
        return packageRecord ? isSpecialPackage(packageRecord) : false;
      });
    }
  }

  // The database is authoritative even when the query fails or returns no
  // enabled rows. Never advertise hard-coded payment methods that checkout
  // cannot actually accept.
  return <GameTopUp game={game} fields={fields || []} packages={customerPackages} dbPaymentMethods={payConfigs || []} paymentConfigAuthoritative bannerUrl={detailBannerUrl} />;
}
