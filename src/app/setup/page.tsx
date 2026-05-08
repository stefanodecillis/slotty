import { notFound } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { db } from '@/lib/db';
import { BRAND } from '@/lib/brand';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: { error?: string };
}

export default async function SetupPage({ searchParams }: PageProps) {
  const userCount = await db.user.count();
  if (userCount >= 1) {
    notFound();
  }

  const errorMessage = searchParams?.error?.slice(0, 200);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-col gap-2 text-center">
        <p className="text-sm font-medium text-muted-foreground">First-run setup</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{BRAND.name}</h1>
        <p className="text-base text-muted-foreground">
          Create your admin account. This page is only available until the first
          user is created.
        </p>
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

          <form method="POST" action="/api/setup" className="flex flex-col gap-4">
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
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                name="displayName"
                required
                autoComplete="name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">Pick anything you'll remember. At least 1 character.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
              />
            </div>

            <Button type="submit" className="w-full">
              Create admin account
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
