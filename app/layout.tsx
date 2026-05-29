import type { Metadata } from 'next';
import { DM_Sans, JetBrains_Mono, Bebas_Neue } from 'next/font/google';
import './globals.css';
import Providers from './providers';

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-bebas-neue',
});

export const metadata: Metadata = {
  title: 'Precision Logistics Tracker',
  description: 'Enterprise grade package tracking.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${dmSans.variable} ${jetbrainsMono.variable} ${bebasNeue.variable}`}>
      <body suppressHydrationWarning className="bg-bg-base text-text-base font-sans antialiased transition-colors duration-300">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}