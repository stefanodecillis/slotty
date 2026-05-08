import type { Metadata, Viewport } from 'next';

import { ThemeProvider, ThemeScript } from '@/lib/theme/provider';
import { SnackbarProvider } from '@/components/ui/Snackbar';
import { BRAND } from '@/lib/brand';

import '@/styles/m3-tokens.css';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: BRAND.tagline,
  applicationName: BRAND.name,
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBFBFF' },
    { media: '(prefers-color-scheme: dark)', color: '#11131A' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        {/* Inter (UI font) + Material Symbols loaded as plain stylesheets so we
            don't go through next/font/google's compiled loader, which has
            a webpack pack-file caching bug that emits noisy build warnings. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
        />
      </head>
      <body className="bg-background text-on-background min-h-dvh font-sans antialiased">
        <ThemeProvider>
          <SnackbarProvider>{children}</SnackbarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
