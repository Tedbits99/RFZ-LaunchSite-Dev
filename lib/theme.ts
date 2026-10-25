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
  return `(function(){var k=${JSON.stringify(THEME_STORAGE_KEY)};function apply(t){if(t!=='light'&&t!=='dark'&&t!=='night')t='dark';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t==='light'?'light':'dark';document.documentElement.dataset.themeReady='true';try{localStorage.setItem(k,t)}catch(e){}}function select(el){var t=el&&el.getAttribute('data-theme-option');if(t)apply(t)}try{var v=localStorage.getItem(k);apply(v==='light'||v==='night'||v==='dark'?v:'dark')}catch(e){apply('dark')}if(document.addEventListener){document.addEventListener('click',function(e){var el=e.target&&e.target.closest?e.target.closest('[data-theme-option]'):null;select(el)});document.addEventListener('keydown',function(e){if(e.key!=='Enter'&&e.key!==' ')return;var el=e.target&&e.target.closest?e.target.closest('[data-theme-option]'):null;if(!el)return;e.preventDefault();select(el)})}})()`;
}
