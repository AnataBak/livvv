import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Source_Sans_3 } from 'next/font/google';
import { ServiceWorkerRegister } from '@/components/sw-register';
import './globals.css';

const headingFont = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-heading',
});

const bodyFont = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'Liv — Gemini Live',
  description: 'Голосовой собеседник на базе Gemini Live с поддержкой камеры, экрана и картинок.',
  applicationName: 'Liv',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Liv',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#1f8a70',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
