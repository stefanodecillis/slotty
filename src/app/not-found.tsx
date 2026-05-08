import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { getCurrentSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Page not found' };

export default async function NotFound() {
  const { user } = await getCurrentSession();

  const primary = user
    ? { href: '/admin', label: 'Back to dashboard' }
    : { href: '/', label: 'Back to home' };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        {/* Calendar-tile visual: a "cancelled" booking */}
        <div
          aria-hidden
          className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
        >
          <div className="border-b border-border bg-destructive/10 px-8 py-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-destructive">
              Cancelled
            </p>
          </div>
          <div className="flex h-28 items-center justify-center px-10">
            <p className="text-5xl font-semibold tracking-tight tabular-nums text-foreground">
              404
            </p>
          </div>
        </div>

        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Slot not found
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          We checked the calendar — this page isn&apos;t on it. Looks like it
          was never booked, or got cancelled along the way.
        </p>

        <div className="mt-8 flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button asChild size="lg">
            <Link href={primary.href}>{primary.label}</Link>
          </Button>
          {user && (
            <Button asChild variant="ghost" size="lg">
              <Link href="/">View public site</Link>
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
