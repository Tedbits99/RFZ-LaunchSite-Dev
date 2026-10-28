'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BadgeCheck, ChevronDown, ChevronLeft, ChevronRight, Headphones, Menu, Search, ShieldCheck, Sparkles, Tag, WalletCards, X, Zap } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import CustomerAccountMenu from '@/components/CustomerAccountMenu';
import AnnouncementPopup from '@/components/AnnouncementPopup';
import SiteFooter from '@/components/SiteFooter';
import { filterStorefrontGames, type StorefrontCatalogFilter } from '@/lib/storefrontCatalog';
import ThemeSelector from '@/components/ThemeSelector';
import { RFZ_PUBLIC_ASSETS } from '@/lib/storefrontAssets';

type Game = { id: string; slug: string; name: string; short_name: string; description: string; is_featured: boolean; sort_order: number };
type Package = { id: string; game_id: string; name: string; amount: string; price_cents: number; original_price_cents: number | null; bonus: string | null };
type HeroPromo = { image_url: string | null; placement: string | null };
type CardPromo = { target_game_id: string | null; image_url: string | null };

const fallbackGames: Game[] = [
  { id:'1', slug:'mobile-legends', name:'Mobile Legends', short_name:'MLBB', description:'Bang Bang', is_featured:true, sort_order:1 },
  { id:'2', slug:'pubg-mobile', name:'PUBG Mobile', short_name:'PUBG', description:'Battle Royale', is_featured:true, sort_order:2 },
  { id:'3', slug:'free-fire', name:'Free Fire', short_name:'FREE FIRE', description:'Battle in style', is_featured:true, sort_order:3 },
  { id:'4', slug:'genshin-impact', name:'Genshin Impact', short_name:'GENSHIN', description:'Open-world RPG', is_featured:true, sort_order:4 },
  { id:'5', slug:'valorant', name:'Valorant', short_name:'VALORANT', description:'Tactical shooter', is_featured:false, sort_order:5 },
  { id:'6', slug:'honor-of-kings', name:'Honor of Kings', short_name:'HOK', description:'The ultimate MOBA', is_featured:false, sort_order:6 },
  { id:'7', slug:'roblox', name:'Roblox', short_name:'ROBLOX', description:'Join the adventure', is_featured:false, sort_order:7 },
  { id:'8', slug:'call-of-duty-mobile', name:'Call of Duty Mobile', short_name:'CODM', description:'The action never stops', is_featured:false, sort_order:8 },
];
const fallbackPackages: Package[] = fallbackGames.map((g, i) => ({ id:`p${i}`, game_id:g.id, name:i === 0 ? 'Weekly Diamond Pass' : i === 1 ? '660 UC' : '100 Diamonds', amount:i === 0 ? 'Weekly Pass' : '100 Credits', price_cents:i === 0 ? 7900 : i === 1 ? 47900 : 7900, original_price_cents:i === 0 ? 9900 : 9900, bonus:i === 0 ? '+ 220 diamonds' : null }));

function db() { try { const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; return url && key ? createClient(url, key) : null; } catch { return null; } }

export default function Home() {
  const [games, setGames] = useState<Game[]>(fallbackGames);
  const [query, setQuery] = useState('');
  const [slide, setSlide] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [heroImages, setHeroImages] = useState<string[]>([...RFZ_PUBLIC_ASSETS.heroBanners]);
  const [heroAspect, setHeroAspect] = useState<number | null>(1600 / 600);
  const [cardBanners, setCardBanners] = useState<Record<string, string>>({});
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [catalogFilter, setCatalogFilter] = useState<StorefrontCatalogFilter>('all');

  useEffect(() => { try { const client = db(); if (!client) return; Promise.resolve(client.from('games').select('id, slug, name, short_name, description, is_featured, sort_order').eq('is_active', true).order('sort_order')).then(({ data, error }) => { if (!error && data?.length) setGames(data as Game[]); }).catch(() => { /* Homepage remains usable with its empty catalog state. */ }); } catch { /* Supabase is optional in local previews. */ } }, []);
  useEffect(() => {
    try {
      const client = db();
      if (!client) return;
      Promise.resolve(client.from('promotions').select('image_url, placement').eq('is_active', true).eq('placement', 'HOMEPAGE_HERO').order('sort_order').limit(5)).then(({ data, error }) => {
        if (error || !data?.length) return;
        const promos = data as HeroPromo[];
        const cmsImages = promos.map((promo) => promo.image_url).filter((url): url is string => Boolean(url && (/^https:\/\//i.test(url) || url.startsWith('/'))));
        // CMS artwork is optional. Never let an incomplete promotion set
        // replace the verified three-banner storefront.
        if (cmsImages.length >= RFZ_PUBLIC_ASSETS.heroBanners.length) {
          setHeroImages(cmsImages.slice(0, RFZ_PUBLIC_ASSETS.heroBanners.length));
          const probe = new window.Image();
          probe.onload = () => { if (probe.naturalWidth > 0 && probe.naturalHeight > 0) setHeroAspect(probe.naturalWidth / probe.naturalHeight); };
          probe.src = cmsImages[0];
        }
      }).catch(() => { /* Local campaign artwork remains the safe fallback. */ });
    } catch { /* Supabase is optional in local previews. */ }
  }, []);
  useEffect(() => { try { const client = db(); if (!client) return; Promise.resolve(client.from('promotions').select('target_game_id, image_url').eq('is_active', true).eq('placement', 'GAME_CARD').order('sort_order')).then(({ data }) => { if (data?.length) { const banners: Record<string, string> = {}; (data as CardPromo[]).forEach(p => { if (p.target_game_id && p.image_url && !banners[p.target_game_id]) banners[p.target_game_id] = p.image_url; }); setCardBanners(banners); } }).catch(() => { /* Optional card artwork does not block the storefront. */ }); } catch { /* Supabase is optional in local previews. */ } }, []);
  const slideCount = heroImages.length;
  useEffect(() => { if (slide > 0 && slide >= slideCount) setSlide(0); }, [slideCount, slide]);
  useEffect(() => { if (slideCount <= 1) return; const timer = setInterval(() => setSlide((s) => (s + 1) % slideCount), 6000); return () => clearInterval(timer); }, [slideCount]);

  const visibleGames = useMemo(() => filterStorefrontGames(games, query, catalogFilter), [games, query, catalogFilter]);
  const openGame = (game: Game) => { window.location.assign(`/games/${game.slug}`); };

  return <main>
    <AnnouncementPopup />
    <header className="sticky top-0 z-30 border-b border-[#14203a] bg-[#030718]/90 backdrop-blur-xl"><div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4">
      <a href="#top" className="font-display flex min-w-0 shrink items-center text-xl font-bold tracking-tight"><img src={RFZ_PUBLIC_ASSETS.logo} alt="RunFazone" width={259} height={68} className="h-6 w-auto max-w-[74px] object-contain sm:h-8 sm:max-w-[150px] lg:h-10 lg:max-w-none" /></a>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2"><div className="hidden items-center gap-2 lg:flex"><nav className="mr-3 flex items-center gap-5 text-[12px] text-slate-400"><a className="text-cyan-300" href="#top">Home</a><a href="#games">Top Up</a><a href="#benefits">About</a><a href="#faq">FAQ</a><a href="#contact">Contact</a></nav><a href="/track-order" className="rounded-lg border border-[#253451] px-3 py-2 text-[12px] text-slate-200 transition hover:border-cyan-400"><Search size={13} className="mr-1 inline text-cyan-300" />Track Order</a><CustomerAccountMenu /><ThemeSelector /></div><div className="flex items-center gap-1 lg:hidden sm:gap-2"><CustomerAccountMenu compactOnMobile /><ThemeSelector /><button className="grid size-10 place-items-center rounded-lg text-slate-200" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileOpen}>{mobileOpen ? <X /> : <Menu />}</button></div></div>
    </div>{mobileOpen && <nav aria-label="Mobile navigation" className="border-t border-[#14203a] px-5 py-4 lg:hidden"><div className="flex flex-col gap-4 text-slate-300"><a href="#games" onClick={() => setMobileOpen(false)}>Top Up</a><a href="#benefits" onClick={() => setMobileOpen(false)}>About</a><a href="#faq" onClick={() => setMobileOpen(false)}>FAQ</a><a href="#contact" onClick={() => setMobileOpen(false)}>Contact</a></div></nav>}</header>

    <section id="top" className="mx-auto max-w-[1180px] px-5 pt-7"><div data-testid="homepage-hero" role="region" aria-label="RunFazone promotional banners" className="hero-glow grid-bg relative overflow-hidden rounded-2xl border border-[#1a3553] bg-gradient-to-br from-[#0b2840] via-[#09152d] to-[#1b092d]" style={heroAspect ? { aspectRatio: String(heroAspect) } : { minHeight: '300px' }}>{heroImages.length > 0 ? heroImages.map((img, i) => img ? <img key={i} src={img} alt="" aria-hidden="true" className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${slide === i ? 'opacity-100' : 'opacity-0'}`} /> : <span key={i} />) : <div className="absolute inset-0" aria-hidden="true" />}{slideCount > 1 && <><button aria-label="Previous promotion" className="absolute left-2 top-1/2 z-20 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/30 sm:left-0 sm:h-8 sm:w-8" onClick={() => setSlide((slide + slideCount - 1) % slideCount)}><ChevronLeft size={16}/></button><button aria-label="Next promotion" className="absolute right-2 top-1/2 z-20 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/30 sm:right-0 sm:h-8 sm:w-8" onClick={() => setSlide((slide + 1) % slideCount)}><ChevronRight size={16}/></button><div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-2 sm:bottom-4">{Array.from({ length: slideCount }, (_, i) => <button aria-label={`Show promotion ${i + 1}`} key={i} onClick={() => setSlide(i)} className={`h-1.5 w-1.5 rounded-full ${slide === i ? 'w-5 bg-cyan-300' : 'bg-slate-600'}`} />)}</div></>}</div></section>

    <section id="games" className="mx-auto max-w-[1180px] px-5 py-20"><div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[.25em] text-cyan-300">Choose your game</p><h2 className="font-display text-3xl font-bold">Cheapest Game Top-Up</h2><p className="mt-2 text-sm text-slate-400">Your portal to affordable game top-ups.</p></div><label className="flex items-center gap-2 rounded-lg border border-[#21304c] bg-[#091126] px-3 py-2 text-xs text-slate-400"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search games" aria-label="Search games" className="w-40 bg-transparent outline-none placeholder:text-slate-600" /></label></div><div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Game catalog filters">{([['all', 'All games'], ['featured', 'Featured']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setCatalogFilter(value)} aria-pressed={catalogFilter === value} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${catalogFilter === value ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-200' : 'border-[#21304c] text-slate-400 hover:border-cyan-400/50 hover:text-cyan-300'}`}>{label}</button>)}</div>{visibleGames.length ? <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{visibleGames.map((game) => { const cardBanner = cardBanners[game.id]; return <button key={game.id} onClick={() => openGame(game)} className="card-hover group relative min-h-[180px] overflow-hidden rounded-xl border border-[#1b2a45] bg-gradient-to-br from-[#132e4b] via-[#10162d] to-[#201032] p-5 text-left">{cardBanner && <img src={cardBanner} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-60 transition group-hover:opacity-80" />}<div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-cyan-400/10 blur-2xl group-hover:bg-cyan-300/20" />{game.slug === 'mobile-legends' ? <img src={RFZ_PUBLIC_ASSETS.mlbbLogo} alt="Mobile Legends" width={96} height={96} className="relative h-10 w-10 rounded-xl border border-white/10 object-cover" /> : <span className="relative grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/10 font-display text-xs font-bold text-cyan-200">{game.short_name.slice(0,4)}</span>}<div className="relative mt-10"><h3 className="font-display font-semibold">{game.name}</h3><p className="mt-1 text-[11px] text-slate-400">{game.description}</p><span className="mt-3 inline-flex items-center text-[11px] text-cyan-300">Top Up Now <ArrowRight size={12} className="ml-1 transition group-hover:translate-x-1" /></span></div></button>; })}</div> : <div className="rounded-2xl border border-dashed border-[#29405f] bg-[#091126] px-6 py-12 text-center"><Search size={24} className="mx-auto text-slate-500" /><h3 className="mt-3 font-display text-lg font-semibold">No games found</h3><p className="mt-1 text-xs text-slate-500">Try a different search or browse all games.</p><button type="button" onClick={() => { setQuery(''); setCatalogFilter('all'); }} className="mt-4 rounded-lg border border-cyan-400/40 px-4 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-400/10">Reset filters</button></div>}</section>

    <section id="benefits" className="border-y border-[#0f1b31] bg-[#050a1b]/70"><div className="mx-auto max-w-[1180px] px-5 py-16"><div className="mb-10 text-center"><p className="text-xs uppercase tracking-[.25em] text-violet-300">Why RunFazone</p><h2 className="font-display mt-2 text-3xl font-bold">Everything you need to play more</h2></div><div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">{[['Fast & Secure Top-Ups','Top up your favorite games quickly and securely.',Zap],['Multiple Payment Options','Choose from convenient payment methods.',WalletCards],['Exclusive Deals & Promotions','Special offers and limited-time deals.',Tag],['Fast Order Processing','Your order is processed quickly after payment.',Sparkles],['Customer Support','Our support team is ready when you need help.',Headphones],['Great Value on Every Top-Up','Get more value with rewards and promotions.',BadgeCheck]].map(([title, body, Icon]) => <div key={title as string} className="flex gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 text-white"><Icon size={18} /></span><div><h3 className="font-display font-semibold">{title as string}</h3><p className="mt-1 text-xs leading-6 text-slate-400">{body as string}</p></div></div>)}</div></div></section>

    <section id="faq" className="mx-auto max-w-[820px] px-5 py-16"><div className="mb-8 text-center"><p className="text-xs uppercase tracking-[.25em] text-cyan-300">Need to know</p><h2 className="font-display mt-2 text-3xl font-bold">Frequently asked questions</h2><p className="mt-2 text-sm text-slate-400">Quick answers before you power up.</p></div><div className="space-y-3">{[['How long does a top-up take?', 'Most orders are delivered within a few minutes after payment is confirmed. You can track the order status at any time.'],['What information do I need to top up?', 'Choose your game, select a package, and enter the player details requested on that game’s top-up page.'],['Can I get help with my order?', 'Yes. Keep your order reference handy and use the support options in the footer so our team can help investigate.'],['Is my payment information secure?', 'RunFazone keeps payment and account information behind server-side controls and never asks you to share passwords in chat.']].map(([question, answer], index) => { const expanded = openFaq === index; return <div key={question} className="overflow-hidden rounded-xl border border-[#1b2a45] bg-[#0b1225]"><button type="button" aria-expanded={expanded} onClick={() => setOpenFaq(expanded ? null : index)} className="flex w-full items-center justify-between gap-4 p-4 text-left text-sm font-semibold transition hover:text-cyan-300"><span>{question}</span><ChevronDown size={17} className={`shrink-0 transition-transform ${expanded ? 'rotate-180 text-cyan-300' : 'text-slate-500'}`} /></button>{expanded && <p className="border-t border-[#1b2a45] px-4 pb-4 pt-3 text-xs leading-6 text-slate-400">{answer}</p>}</div>; })}</div></section>

    <section id="contact" className="mx-auto max-w-[1180px] px-5 py-14"><div className="grid gap-3 sm:grid-cols-4">{[['Secure','Payment Insured Security',ShieldCheck],['Fast','Almost Instant delivery',Zap],['Trusted','100% Legit. Safe & Secured',BadgeCheck],['Support','Active customer service',Headphones]].map(([a,b,Icon]) => <div key={a as string} className="rounded-xl border border-[#1d2a43] bg-[#0b1225] p-5 text-center"><Icon size={20} className="mx-auto mb-2 text-cyan-300" /><p className="font-display text-sm font-semibold">{a as string}</p><p className="mt-1 text-[10px] text-slate-400">{b as string}</p></div>)}</div></section>
    
    <SiteFooter />
  </main>;
}
