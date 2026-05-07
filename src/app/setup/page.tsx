import { notFound } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
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
        <p className="text-label-l text-on-surface-variant">First-run setup</p>
        <h1 className="text-display-s text-on-background">{BRAND.name}</h1>
        <p className="text-body-l text-on-surface-variant">
          Create your admin account. This page is only available until the first
          user is created.
        </p>
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

          <form method="POST" action="/api/setup" className="flex flex-col gap-4">
            <TextField
              label="Username"
              name="username"
              required
              autoComplete="username"
              autoFocus
            />
            <TextField
              label="Display name"
              name="displayName"
              required
              autoComplete="name"
            />
            <TextField
              label="Email"
              name="email"
              type="email"
              required
              autoComplete="email"
            />
            <TextField
              label="Password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              helperText="At least 12 characters with upper- and lowercase letters and a digit."
            />
            <TextField
              label="Confirm password"
              name="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
            />

            <Button type="submit" variant="filled" fullWidth>
              Create admin account
            </Button>
          </form>
        </Card.Content>
      </Card>
    </main>
  );
}
