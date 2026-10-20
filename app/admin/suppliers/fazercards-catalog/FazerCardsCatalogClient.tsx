'use client';

import { useState, useCallback, useEffect } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import {
  Loader2, Search, ChevronRight, ArrowLeft, RefreshCw,
  DollarSign, AlertTriangle, Check, Package, Tag, Eye,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Category {
  category_id: string;
  name: string;
  note?: string | null;
}

interface Offer {
  offer_id: string;
  name: string;
  price_usd: string;
}

interface Field {
  key: string;
  label: string;
  type: string;
}

interface CategoriesResponse {
  ok: boolean;
  kind: string;
  items: Category[];
  meta: { total: number; limit: number; next_cursor: string | null; has_more: boolean };
}

interface OffersResponse {
  ok: boolean;
  kind: string;
  category_id: string;
  name: string;
  offers: Offer[];
  fields: Field[];
  note: string | null;
}

const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function edgeAuthHeaders(): Promise<Record<string, string>> {
  const client = getSupabaseBrowserClient();
  const { data: { session } } = client ? await client.auth.getSession() : { data: { session: null } };
  if (!session?.access_token) throw new Error('Admin session required');
  return { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY || '' };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FazerCardsCatalogClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [meta, setMeta] = useState<{ total: number; has_more: boolean; next_cursor: string | null } | null>(null);
  const [loadingCats, setLoadingCats] = useState(true);
  const [catError, setCatError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [offersLatency, setOffersLatency] = useState<number | null>(null);

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceCurrency, setBalanceCurrency] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const EDGE_URL = `${SUPABASE_URL}/functions/v1/fazercards-test`;

  const fetchCategories = useCallback(async (cursor?: string) => {
    setLoadingCats(true);
    setCatError(null);
    try {
      const url = cursor
        ? `${EDGE_URL}/categories?cursor=${encodeURIComponent(cursor)}`
        : `${EDGE_URL}/categories`;
      const res = await fetch(url, { headers: await edgeAuthHeaders() });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to fetch categories');
      const data = json.data as CategoriesResponse;
      setCategories(prev => cursor ? [...prev, ...data.items] : data.items);
      setMeta(data.meta);
    } catch (err) {
      setCatError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingCats(false);
    }
  }, [EDGE_URL]);

  const fetchBalance = useCallback(async () => {
    setLoadingBalance(true);
    try {
      const res = await fetch(`${EDGE_URL}/balance`, {
        headers: await edgeAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        const data = json.data as Record<string, unknown>;
        setBalance(typeof data.balance === 'number' ? data.balance : null);
        setBalanceCurrency(typeof data.currency === 'string' ? data.currency : null);
      }
    } catch {
      // silent
    } finally {
      setLoadingBalance(false);
    }
  }, [EDGE_URL]);

  useEffect(() => {
    fetchCategories();
    fetchBalance();
  }, [fetchCategories, fetchBalance]);

  async function handleSelectCategory(cat: Category) {
    setSelectedCategory(cat);
    setOffers([]);
    setFields([]);
    setOffersError(null);
    setLoadingOffers(true);
    setOffersLatency(null);
    try {
      const res = await fetch(`${EDGE_URL}/offers?category_id=${encodeURIComponent(cat.category_id)}`, {
        headers: await edgeAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to fetch offers');
      setOffersLatency(json.latencyMs ?? null);
      const data = json.data as OffersResponse;
      setOffers(data.offers || []);
      setFields(data.fields || []);
    } catch (err) {
      setOffersError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingOffers(false);
    }
  }

  function handleBack() {
    setSelectedCategory(null);
    setOffers([]);
    setFields([]);
    setOffersError(null);
  }

  function handleLoadMore() {
    if (meta?.next_cursor) {
      fetchCategories(meta.next_cursor);
    }
  }

  const filteredCats = search
    ? categories.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.category_id.toLowerCase().includes(search.toLowerCase())
      )
    : categories;

  // ─── Render: Offers view ──────────────────────────────────────────────────

  if (selectedCategory) {
    return (
      <div className="min-h-screen bg-[#030718]">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#253451] px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Categories
          </button>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-100">
              {selectedCategory.name}
            </h1>
            <p className="text-xs text-slate-500">
              category_id: <span className="font-mono">{selectedCategory.category_id}</span>
            </p>
          </div>
        </div>

        {/* Required fields */}
        {fields.length > 0 && (
          <div className="mb-6 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <Tag className="h-4 w-4 text-cyan-400" />
              Required Player Fields
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map(f => (
                <div key={f.key} className="rounded-lg border border-[#1b2a45] bg-[#0a1124] px-4 py-3">
                  <div className="text-sm font-medium text-slate-200">{f.label}</div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                    <span className="font-mono">key: {f.key}</span>
                    <span className="rounded bg-[#1b2a45] px-1.5 py-0.5">type: {f.type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Offers */}
        {loadingOffers ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
            <p className="mt-3 text-sm text-slate-500">Loading offers…</p>
          </div>
        ) : offersError ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-medium">Failed to load offers</span>
            </div>
            <p className="mt-2 text-sm text-rose-300/70">{offersError}</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                <Package className="h-4 w-4 text-cyan-400" />
                Available Offers ({offers.length})
                {offersLatency !== null && (
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    ({offersLatency}ms)
                  </span>
                )}
              </h3>
            </div>

            {offers.length === 0 ? (
              <p className="text-sm text-slate-500">No offers available for this category.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-[#1b2a45]">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#1b2a45] bg-[#0b1225] text-slate-400">
                      <th className="px-4 py-3 font-medium">offer_id</th>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3.5 w-3.5" />
                          Supplier Cost (USD)
                        </span>
                      </th>
                      <th className="px-4 py-3 font-medium">Selling Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1b2a45]">
                    {offers.map(o => (
                      <tr key={o.offer_id} className="bg-[#0a1124] transition hover:bg-[#0e1530]">
                        <td className="px-4 py-3 font-mono text-slate-400">{o.offer_id}</td>
                        <td className="px-4 py-3 text-slate-200">{o.name}</td>
                        <td className="px-4 py-3">
                          <span className="text-amber-400">${o.price_usd}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-md border border-[#253451] bg-[#1b2a45] px-2 py-1 text-xs text-slate-500">
                            Not set — configure markup
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="text-xs leading-relaxed text-amber-300/80">
                  <p className="font-medium text-amber-300">Supplier cost vs selling price</p>
                  <p className="mt-1">
                    The <span className="text-amber-400">Supplier Cost (USD)</span> column shows
                    the real FazerCards price. Your customer-facing selling price is separate and
                    can be configured with a markup per offer. No order will be placed until you
                    explicitly approve a category, offer, and test player ID.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ─── Render: Categories list ──────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#030718]">
      {/* Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-100">
            FazerCards Catalog Browser
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Browse real FazerCards top-up categories and offers. No orders will be placed.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Balance badge */}
          {loadingBalance ? (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking balance…
            </div>
          ) : balance !== null ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <DollarSign className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-300">
                {balance.toFixed(4)} {balanceCurrency || 'USD'}
              </span>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => { fetchCategories(); fetchBalance(); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#253451] px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search categories by name or ID…"
          className="w-full rounded-lg border border-[#253451] bg-[#0a1124] py-2.5 pl-10 pr-4 text-sm text-slate-200 outline-none focus:border-cyan-400"
        />
      </div>

      {/* Loading */}
      {loadingCats && categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
          <p className="mt-3 text-sm text-slate-500">Loading categories…</p>
        </div>
      ) : catError ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-medium">Failed to load categories</span>
          </div>
          <p className="mt-2 text-sm text-rose-300/70">{catError}</p>
        </div>
      ) : (
        <>
          {/* Category count */}
          <p className="mb-3 text-xs text-slate-500">
            Showing {filteredCats.length} of {meta?.total ?? filteredCats.length} categories
          </p>

          {/* Category grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCats.map(cat => (
              <button
                key={cat.category_id}
                type="button"
                onClick={() => handleSelectCategory(cat)}
                className="group rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 text-left transition hover:border-cyan-400/40 hover:bg-[#0e1530]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium text-slate-200 group-hover:text-cyan-300">
                      {cat.name}
                    </h3>
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      {cat.category_id}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 transition group-hover:text-cyan-400" />
                </div>
                {cat.note && (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">
                    {cat.note}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-1.5 text-xs text-cyan-400/0 transition group-hover:text-cyan-400/70">
                  <Eye className="h-3 w-3" />
                  View offers
                </div>
              </button>
            ))}
          </div>

          {/* Load more */}
          {meta?.has_more && !search && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingCats}
                className="inline-flex items-center gap-2 rounded-lg border border-[#253451] px-5 py-2.5 text-sm text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300 disabled:opacity-50"
              >
                {loadingCats ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Load more categories
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
