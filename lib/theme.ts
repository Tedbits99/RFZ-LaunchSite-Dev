export const THEME_STORAGE_KEY = 'rfz-appearance';
export const THEMES = ['light', 'dark', 'night'] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: string | null | undefined): value is Theme {
  return value === 'light' || value === 'dark' || value === 'night';
}

export function resolveTheme(value: string | null | undefined): Theme {
  return isTheme(value) ? value : 'dark';
}

export function themeBootScript(): string {
  return `(function(){var k=${JSON.stringify(THEME_STORAGE_KEY)},o=['light','dark','night'];function valid(t){return o.indexOf(t)!==-1}function apply(t){if(!valid(t))t='dark';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t==='light'?'light':'dark';document.documentElement.dataset.themeReady='true';try{localStorage.setItem(k,t)}catch(e){}}function cycle(){var current=document.documentElement.dataset.theme||'dark';apply(o[(o.indexOf(current)+1)%o.length])}try{var v=localStorage.getItem(k);apply(valid(v)?v:'dark')}catch(e){apply('dark')}if(document.addEventListener){document.addEventListener('click',function(e){if(window.__rfzThemeHydrated)return;var el=e.target&&e.target.closest?e.target.closest('[data-theme-toggle]'):null;if(el)cycle()});document.addEventListener('keydown',function(e){if(window.__rfzThemeHydrated||e.key!=='Enter'&&e.key!==' ')return;var el=e.target&&e.target.closest?e.target.closest('[data-theme-toggle]'):null;if(!el)return;e.preventDefault();cycle()})}})()`;
}
