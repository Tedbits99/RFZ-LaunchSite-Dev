'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BadgeCheck, ChevronLeft, ChevronRight, Headphones, Menu, Search, ShieldCheck, Sparkles, Tag, UserRound, WalletCards, X, Zap } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { createCustomerBrowserClient } from '@/lib/authSessionBrowserClients';
import AnnouncementPopup from '@/components/AnnouncementPopup';
import SiteFooter from '@/components/SiteFooter';

type Game = { id: string; slug: string; name: string; short_name: string; description: string; is_featured: boolean; sort_order: number };
type Package = { id: string; game_id: string; name: string; amount: string; price_cents: number; original_price_cents: number | null; bonus: string | null };
type HeroPromo = { image_url: string | null; placement: string | null; cta_href: string | null };
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
  const [heroImages, setHeroImages] = useState<(string | null)[]>([]);
  const [heroCtas, setHeroCtas] = useState<(string | null)[]>([]);
  const [heroAspect, setHeroAspect] = useState<number | null>(null);
  const [heroLoaded, setHeroLoaded] = useState(false);
  const [cardBanners, setCardBanners] = useState<Record<string, string>>({});
  const [customerSignedIn, setCustomerSignedIn] = useState(false);

  useEffect(() => { try { const client = db(); if (!client) return; Promise.resolve(client.from('games').select('*').eq('is_active', true).order('sort_order')).then(({ data, error }) => { if (!error && data?.length) setGames(data as Game[]); }).catch(() => {}); } catch {} }, []);
  useEffect(() => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; setHeroLoaded(true); } };
    const timeout = setTimeout(finish, 5000);
    try {
      const client = db();
      if (!client) { clearTimeout(timeout); finish(); return; }
      Promise.resolve(client.from('promotions').select('image_url, placement, cta_href').eq('is_active', true).eq('placement', 'HOMEPAGE_HERO').order('sort_order').limit(5)).then(({ data, error }) => {
        clearTimeout(timeout);
        if (error || !data?.length) { finish(); return; }
        const promos = data as HeroPromo[];
        setHeroImages(promos.map(p => p.image_url));
        setHeroCtas(promos.map(p => p.cta_href));
        const firstImg = promos.map(p => p.image_url).find(Boolean);
        if (firstImg) {
          const probe = new window.Image();
          probe.onload = () => { if (probe.naturalWidth > 0 && probe.naturalHeight > 0) setHeroAspect(probe.naturalWidth / probe.naturalHeight); };
          probe.src = firstImg;
        }
        finish();
      }).catch(() => { clearTimeout(timeout); finish(); });
    } catch { clearTimeout(timeout); finish(); }
  }, []);
  useEffect(() => { try { const client = db(); if (!client) return; Promise.resolve(client.from('promotions').select('target_game_id, image_url').eq('is_active', true).eq('placement', 'GAME_CARD').order('sort_order')).then(({ data }) => { if (data?.length) { const banners: Record<string, string> = {}; (data as CardPromo[]).forEach(p => { if (p.target_game_id && p.image_url && !banners[p.target_game_id]) banners[p.target_game_id] = p.image_url; }); setCardBanners(banners); } }).catch(() => {}); } catch {} }, []);
  useEffect(() => {
    let cancelled = false;
    try {
      const customer = createCustomerBrowserClient();
      customer.auth.getSession().then(({ data }) => {
        if (!cancelled) setCustomerSignedIn(Boolean(data.session));
      }).catch(() => {});
    } catch {
      // The signed-out destination is the safe default while Auth is unavailable.
    }
    return () => { cancelled = true; };
  }, []);
  const slideCount = heroImages.length;
  useEffect(() => { if (slide > 0 && slide >= slideCount) setSlide(0); }, [slideCount, slide]);
  useEffect(() => { if (slideCount <= 1) return; const timer = setInterval(() => setSlide((s) => (s + 1) % slideCount), 6000); return () => clearInterval(timer); }, [slideCount]);

  const visibleGames = useMemo(() => games.filter((g) => `${g.name} ${g.short_name}`.toLowerCase().includes(query.toLowerCase())), [games, query]);
  const heroSlides = [['Level Up', 'For Less', 'Affordable top-ups for your favorite games.'], ['Power Your', 'Next Match', 'Instant credits, secure payments, zero hassle.'], ['Play More,', 'Spend Less', 'Exclusive bundles made for every gamer.'], ['Level Up', 'Faster', 'Quick delivery for every top-up.'], ['Game On,', 'Save More', 'Daily deals and exclusive bundles.']];
  const heroCopy = heroSlides[slide] ?? heroSlides[0];
  const openGame = (game: Game) => { window.location.assign(`/games/${game.slug}`); };

  return <main>
    <AnnouncementPopup />
    <header className="sticky top-0 z-30 border-b border-[#14203a] bg-[#030718]/90 backdrop-blur-xl"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4">
      <a href="#top" className="font-display flex items-center text-xl font-bold tracking-tight"><img src="https://res.cloudinary.com/dex5ykrfs/image/upload/v1789837643/R_logo_1_au2g5c.png" alt="RunFazone" width={1701} height={378} className="h-10 w-auto object-contain" /></a>
      <div className="hidden items-center gap-2 md:flex"><nav className="mr-5 flex items-center gap-5 text-[12px] text-slate-400"><a className="text-cyan-300" href="#top">Home</a><a href="#games">Top Up</a><a href="#benefits">About</a><a href="#faq">FAQ</a><a href="#contact">Contact</a></nav><a href="#track" className="rounded-lg border border-[#253451] px-3 py-2 text-[12px] text-slate-200 transition hover:border-cyan-400"><Search size={13} className="mr-1 inline text-cyan-300" />Track Order</a><a href={customerSignedIn ? '/account' : '/login'} className="rounded-lg border border-[#253451] px-3 py-2 text-[12px] text-slate-300"><UserRound size={13} className="mr-1 inline text-cyan-300" />Account</a></div>
      <button className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Open menu">{mobileOpen ? <X /> : <Menu />}</button>
    </div>{mobileOpen && <nav className="border-t border-[#14203a] px-5 py-4 md:hidden"><div className="flex flex-col gap-4 text-slate-300"><a href="#games">Top Up</a><a href="#benefits">About</a><a href="#faq">FAQ</a><a href="#contact">Contact</a><a href={customerSignedIn ? '/account' : '/login'}><UserRound size={13} className="mr-1 inline text-cyan-300" />Account</a></div></nav>}</header>

    <section id="top" className="mx-auto max-w-[1180px] px-5 pt-7"><div className="hero-glow grid-bg relative overflow-hidden rounded-2xl border border-[#1a3553] bg-gradient-to-br from-[#0b2840] via-[#09152d] to-[#1b092d]" style={heroAspect ? { aspectRatio: String(heroAspect) } : { minHeight: '300px' }}>{!heroLoaded ? <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#0b2840] via-[#09152d] to-[#1b092d]" /> : heroImages.length > 0 ? <>{heroImages.map((img, i) => img ? <img key={i} src={img} alt="" aria-hidden="true" className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${slide === i ? 'opacity-100' : 'opacity-0'}`} /> : <span key={i} />)}{heroCtas[slide] && <a href={heroCtas[slide]!} className="absolute inset-0 z-10" aria-label="Promotion link" />}</> : <><div className="absolute -right-20 top-1/2 h-80 w-80 -translate-y-1/2 rounded-full bg-cyan-400/10 blur-3xl" /><div className="absolute inset-0 flex flex-col justify-center p-6 sm:p-8 md:p-14"><div className="relative max-w-xl"><span className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-300 sm:mb-5"><Sparkles size={12} /> Limited time offer</span><h1 className="font-display text-4xl font-bold leading-[.95] sm:text-5xl md:text-7xl">{heroCopy[0]}<br /><span className="bg-gradient-to-r from-cyan-300 to-blue-500 bg-clip-text text-transparent">{heroCopy[1]}</span></h1><p className="mt-4 max-w-sm text-xs text-slate-300 sm:mt-5 sm:text-sm">{heroCopy[2]}</p><a href="#games" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2.5 text-xs font-semibold shadow-lg shadow-blue-900/40 transition hover:brightness-110 sm:mt-7 sm:px-5 sm:py-3">Explore Games <ArrowRight size={14} /></a><div className="mt-6 flex gap-4 text-[10px] text-slate-400 sm:mt-8 sm:gap-5"><span><Zap size={13} className="mr-1 inline text-cyan-300" />Easy & Fast</span><span><ShieldCheck size={13} className="mr-1 inline text-cyan-300" />Secure</span><span><Tag size={13} className="mr-1 inline text-violet-300" />Best Prices</span></div></div></div></>}{slideCount > 1 && <><button className="absolute left-2 top-1/2 z-20 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/30 sm:left-0 sm:h-8 sm:w-8" onClick={() => setSlide((slide + slideCount - 1) % slideCount)}><ChevronLeft size={16}/></button><button className="absolute right-2 top-1/2 z-20 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/30 sm:right-0 sm:h-8 sm:w-8" onClick={() => setSlide((slide + 1) % slideCount)}><ChevronRight size={16}/></button><div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-2 sm:bottom-4">{Array.from({ length: slideCount }, (_, i) => <button key={i} onClick={() => setSlide(i)} className={`h-1.5 w-1.5 rounded-full ${slide === i ? 'w-5 bg-cyan-300' : 'bg-slate-600'}`} />)}</div></>}</div></section>

    <section id="games" className="mx-auto max-w-[1180px] px-5 py-20"><div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[.25em] text-cyan-300">Choose your game</p><h2 className="font-display text-3xl font-bold">Cheapest Game Top-Up</h2><p className="mt-2 text-sm text-slate-400">Your portal to affordable game top-ups.</p></div><label className="flex items-center gap-2 rounded-lg border border-[#21304c] bg-[#091126] px-3 py-2 text-xs text-slate-400"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search games" className="w-40 bg-transparent outline-none placeholder:text-slate-600" /></label></div><div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{visibleGames.map((game, index) => { const cardBanner = cardBanners[game.id]; return <button key={game.id} onClick={() => openGame(game)} className="card-hover group relative min-h-[180px] overflow-hidden rounded-xl border border-[#1b2a45] bg-gradient-to-br from-[#132e4b] via-[#10162d] to-[#201032] p-5 text-left">{cardBanner && <img src={cardBanner} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-60 transition group-hover:opacity-80" />}<div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-cyan-400/10 blur-2xl group-hover:bg-cyan-300/20" />{game.slug === 'mobile-legends' ? <img src="https://res.cloudinary.com/dex5ykrfs/image/upload/v1753406334/app_icon_0_sstwtq.png" alt="Mobile Legends" width={200} height={200} className="relative h-10 w-10 rounded-xl border border-white/10 object-cover" /> : <span className="relative grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/10 font-display text-xs font-bold text-cyan-200">{game.short_name.slice(0,4)}</span>}<div className="relative mt-10"><h3 className="font-display font-semibold">{game.name}</h3><p className="mt-1 text-[11px] text-slate-400">{game.description}</p><span className="mt-3 inline-flex items-center text-[11px] text-cyan-300">Top Up Now <ArrowRight size={12} className="ml-1 transition group-hover:translate-x-1" /></span></div></button>; })}</div></section>

    <section id="benefits" className="border-y border-[#0f1b31] bg-[#050a1b]/70"><div className="mx-auto max-w-[1180px] px-5 py-16"><div className="mb-10 text-center"><p className="text-xs uppercase tracking-[.25em] text-violet-300">Why RunFazone</p><h2 className="font-display mt-2 text-3xl font-bold">Everything you need to play more</h2></div><div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">{[['Fast & Secure Top-Ups','Top up your favorite games quickly and securely.',Zap],['Multiple Payment Options','Choose from convenient payment methods.',WalletCards],['Exclusive Deals & Promotions','Special offers and limited-time deals.',Tag],['Fast Order Processing','Your order is processed quickly after payment.',Sparkles],['Customer Support','Our support team is ready when you need help.',Headphones],['Great Value on Every Top-Up','Get more value with rewards and promotions.',BadgeCheck]].map(([title, body, Icon]) => <div key={title as string} className="flex gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 text-white"><Icon size={18} /></span><div><h3 className="font-display font-semibold">{title as string}</h3><p className="mt-1 text-xs leading-6 text-slate-400">{body as string}</p></div></div>)}</div></div></section>

    <section id="contact" className="mx-auto max-w-[1180px] px-5 py-14"><div className="grid gap-3 sm:grid-cols-4">{[['Secure','Payment Insured Security',ShieldCheck],['Fast','Almost Instant delivery',Zap],['Trusted','100% Legit. Safe & Secured',BadgeCheck],['Support','Active customer service',Headphones]].map(([a,b,Icon]) => <div key={a as string} className="rounded-xl border border-[#1d2a43] bg-[#0b1225] p-5 text-center"><Icon size={20} className="mx-auto mb-2 text-cyan-300" /><p className="font-display text-sm font-semibold">{a as string}</p><p className="mt-1 text-[10px] text-slate-400">{b as string}</p></div>)}</div></section>
    
    <SiteFooter />
  </main>;
}
