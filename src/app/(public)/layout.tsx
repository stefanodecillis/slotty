import type { ReactNode } from 'react';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';

export const metadata = {
  title: { default: 'Book a meeting', template: `%s` },
};

/**
 * Public-facing layout. Intentionally bare — no admin nav, no edit chrome —
 * because this layout is what bookers see. Branding is provided by the page,
 * since each event type can have its own owner avatar/name.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-on-background">
      <main className="flex-1">{children}</main>
      <footer className="px-6 py-4 text-center text-body-s text-on-surface-variant">
        Powered by{' '}
        <Link
          href={BRAND.github}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          {BRAND.name}
        </Link>
      </footer>
    </div>
  );
}
