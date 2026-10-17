import './globals.css';
import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' });

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
