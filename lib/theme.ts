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
  return `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var v=localStorage.getItem(k);var t=v==='light'||v==='night'||v==='dark'?v:'dark';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t==='light'?'light':'dark';document.documentElement.dataset.themeReady='true'}catch(e){document.documentElement.dataset.theme='dark';document.documentElement.style.colorScheme='dark';document.documentElement.dataset.themeReady='true'}})()`;
}
