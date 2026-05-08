import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { db } from '@/lib/db';
import { BRAND } from '@/lib/brand';
import { getCurrentSession } from '@/lib/auth/session';
import { sanitizeNext } from '@/lib/auth/safe-next';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: { error?: string; next?: string };
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
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{BRAND.name}</h1>
        <p className="text-base text-muted-foreground">Sign in to your admin account.</p>
      </header>

      <Card className="p-2">
        <CardContent className="flex flex-col gap-4 p-6">
          {errorMessage && (
            <div
              role="alert"
              className="rounded-sm bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {errorMessage}
            </div>
          )}

          <form method="POST" action="/api/admin/login" className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next} />
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                required
                autoComplete="username"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
