import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { notFound } from 'next/navigation';
import GameTopUp from './GameTopUp';
import { minimumSalePriceCents } from '@/lib/catalogPricing';

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
  saleable: boolean;
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

  const publicPackages = packages || [];
  let customerPackages: CustomerPackage[] = publicPackages.map((pkg) => ({ ...pkg, saleable: false }));
  if (adminSupabase && publicPackages.length > 0) {
    const [{ data: supplierPackages, error: supplierPackagesError }, { data: supplier }, { data: settings, error: settingsError }] = await Promise.all([
      adminSupabase.from('packages').select('id,supplier_offer_id,supplier_category_id,supplier_cost_usd,supplier_review_required').in('id', publicPackages.map((pkg) => pkg.id)),
      adminSupabase.from('suppliers').select('id,enabled').eq('code', 'fazercards').maybeSingle(),
      adminSupabase.from('app_settings').select('reference_usd_php_rate,payment_fee_reserve_bps,payment_fee_fixed_cents,supplier_fulfillment_release_enabled').eq('id', 1).maybeSingle(),
    ]);
    if (!supplierPackagesError) {
      const privateById = new Map((supplierPackages || []).map((pkg) => [pkg.id, pkg]));
      const releaseReady = process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE === 'enabled'
        && settingsError === null
        && settings?.supplier_fulfillment_release_enabled === true
        && supplier?.enabled === true
        && settings.payment_fee_reserve_bps !== null
        && settings.payment_fee_fixed_cents !== null;
      const linkedIds = (supplierPackages || [])
        .filter((pkg) => pkg.supplier_offer_id || pkg.supplier_category_id)
        .map((pkg) => pkg.id);
      const { data: mappings, error: mappingsError } = releaseReady && supplier && linkedIds.length
        ? await adminSupabase.from('supplier_package_mappings')
          .select('package_id,supplier_product_id,enabled,metadata')
          .eq('supplier_id', supplier.id)
          .eq('enabled', true)
          .in('package_id', linkedIds)
        : { data: [], error: null };
      const validMappingIds = new Set((mappingsError ? [] : mappings || []).filter((mapping) => {
        const internal = privateById.get(mapping.package_id);
        const customer = publicPackages.find((pkg) => pkg.id === mapping.package_id);
        const metadata = mapping.metadata as { category_id?: string } | null;
        const minimum = !internal?.supplier_cost_usd || !settings?.reference_usd_php_rate
          || settings.payment_fee_reserve_bps == null || settings.payment_fee_fixed_cents == null
          ? null
          : minimumSalePriceCents(Number(internal.supplier_cost_usd), Number(settings.reference_usd_php_rate), Number(settings.payment_fee_reserve_bps), Number(settings.payment_fee_fixed_cents));
        return Boolean(internal?.supplier_offer_id
          && internal.supplier_category_id
          && internal.supplier_review_required === false
          && mapping.supplier_product_id === internal.supplier_offer_id
          && metadata?.category_id === internal.supplier_category_id
          && minimum !== null
          && customer
          && customer.price_cents >= minimum);
      }).map((mapping) => mapping.package_id));

      customerPackages = publicPackages.map((pkg) => {
        const internal = privateById.get(pkg.id);
        const supplierLinked = Boolean(internal?.supplier_offer_id || internal?.supplier_category_id);
        return {
          ...pkg,
          // Keep approved catalog content visible while the two release locks
          // are off; only validated direct products or released supplier offers
          // can proceed to checkout.
          saleable: !supplierPackagesError && (!supplierLinked || validMappingIds.has(pkg.id)),
        };
      });
    }
  }

  return <GameTopUp game={game} fields={fields || []} packages={customerPackages} dbPaymentMethods={payConfigs || []} paymentConfigAuthoritative bannerUrl={detailBannerUrl} />;
}
