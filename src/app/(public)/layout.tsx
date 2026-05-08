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
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <main className="flex-1">{children}</main>
      <footer className="px-6 py-4 text-center">
        <Link
          href={BRAND.github}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-muted-foreground/60 underline-offset-2 transition-colors hover:text-muted-foreground hover:underline"
        >
          Powered by {BRAND.name}
        </Link>
      </footer>
    </div>
  );
}
