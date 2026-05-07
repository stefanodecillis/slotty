import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { db } from '@/lib/db';
import { BRAND } from '@/lib/brand';
import { getCurrentSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: { error?: string; next?: string };
}

const SAFE_NEXT_RE = /^\/[^\/].*$/u;

function sanitizeNext(next: string | undefined): string {
  if (!next) return '/admin';
  if (!SAFE_NEXT_RE.test(next)) return '/admin';
  if (next.startsWith('//')) return '/admin';
  return next;
}

export default async function AdminLoginPage({ searchParams }: PageProps) {
  const { user } = await getCurrentSession();
  if (user) {
    redirect(sanitizeNext(searchParams?.next));
  }

  const userCount = await db.user.count();
  if (userCount === 0) {
    redirect('/setup');
  }

  const errorMessage = searchParams?.error?.slice(0, 200);
  const next = sanitizeNext(searchParams?.next);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-display-s text-on-background">{BRAND.name}</h1>
        <p className="text-body-l text-on-surface-variant">Sign in to your admin account.</p>
      </header>

      <Card variant="elevated" className="p-2">
        <Card.Content className="flex flex-col gap-4 p-6">
          {errorMessage && (
            <div
              role="alert"
              className="rounded-shape-xs bg-error-container px-4 py-3 text-body-m text-on-error-container"
            >
              {errorMessage}
            </div>
          )}

          <form method="POST" action="/api/admin/login" className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next} />
            <TextField
              label="Username"
              name="username"
              required
              autoComplete="username"
              autoFocus
            />
            <TextField
              label="Password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
            <Button type="submit" variant="filled" fullWidth>
              Sign in
            </Button>
          </form>
        </Card.Content>
      </Card>
    </main>
  );
}
