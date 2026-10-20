import './globals.css';
import type { Metadata } from 'next';
import localFont from 'next/font/local';

// Self-hosted latin subsets; avoids build-time Google Fonts fetches that fail
// on network-restricted build machines (ETIMEDOUT in Netlify builds).
const inter = localFont({
  src: './fonts/inter-latin.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
});
const spaceGrotesk = localFont({
  src: './fonts/space-grotesk-latin.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'RunFazone | Game Top-Up Made Easy',
  description: 'Fast, secure, and affordable game top-ups for your favorite games.',
  icons: {
    icon: [
      { url: '/fav_icon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/fav_icon.png', type: 'image/png' },
    ],
    apple: [{ url: '/fav_icon-180.png', sizes: '180x180' }],
  },
  openGraph: { title: 'RunFazone', description: 'Level up for less with RunFazone.' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className={`${inter.className} ${spaceGrotesk.variable}`}>{children}</body></html>;
}
