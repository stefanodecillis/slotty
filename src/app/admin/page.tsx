import { Card } from '@/components/ui/Card';
import { requireUserOrRedirect } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-label-l text-on-surface-variant">Phase 1</p>
        <h1 className="text-display-s text-on-background">Welcome, {user.displayName}</h1>
      </header>

      <Card variant="elevated" className="p-2">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Phase 1 complete.</h2>
        </Card.Header>
        <Card.Content className="space-y-2 text-body-m text-on-surface-variant">
          <p>
            You're signed in. Coming soon: calendars, event types, bookings.
          </p>
          <p>
            Username: <span className="font-mono text-on-surface">{user.username}</span>
          </p>
          <p>
            Email: <span className="font-mono text-on-surface">{user.email}</span>
          </p>
        </Card.Content>
      </Card>
    </div>
  );
}
