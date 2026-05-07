import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SnackbarProvider } from '@/components/ui/Snackbar';
import { EventTypesList } from './_components/event-types-list';
import type { EventTypeRow } from './_components/event-types-list';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function EventTypesPage() {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fevent-types');

  const all = await db.eventType.findMany({
    where: { userId: user.id },
    orderBy: [{ archived: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    include: {
      destinationCalendar: { select: { name: true } },
    },
  });

  const active: EventTypeRow[] = all
    .filter((e) => !e.archived)
    .map((e) => ({
      id: e.id,
      title: e.title,
      slug: e.slug,
      durationMinutes: e.durationMinutes,
      color: e.color,
      hidden: e.hidden,
      archived: e.archived,
      destinationCalendar: e.destinationCalendar,
    }));

  const archived: EventTypeRow[] = all
    .filter((e) => e.archived)
    .map((e) => ({
      id: e.id,
      title: e.title,
      slug: e.slug,
      durationMinutes: e.durationMinutes,
      color: e.color,
      hidden: e.hidden,
      archived: e.archived,
      destinationCalendar: e.destinationCalendar,
    }));

  return (
    <SnackbarProvider>
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex items-start justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-label-l text-on-surface-variant">Event Types</p>
            <h1 className="text-display-s text-on-background">Manage Event Types</h1>
            <p className="text-body-m text-on-surface-variant">
              Create and manage your bookable offerings.
            </p>
          </div>
          <Link href="/admin/event-types/new">
            <Button variant="filled">
              <span className="material-symbols-outlined mr-1 text-[18px]">add</span>
              New event type
            </Button>
          </Link>
        </header>

        {active.length === 0 && archived.length === 0 ? (
          <Card variant="outlined">
            <Card.Content>
              <div className="flex flex-col items-center gap-4 py-12 text-center">
                <span className="material-symbols-outlined text-[48px] text-on-surface-variant">
                  calendar_add_on
                </span>
                <div>
                  <p className="text-headline-s text-on-surface">No event types yet</p>
                  <p className="text-body-m text-on-surface-variant mt-1">
                    Create your first bookable offering to get started.
                  </p>
                </div>
                <Link href="/admin/event-types/new">
                  <Button variant="filled">Create event type</Button>
                </Link>
              </div>
            </Card.Content>
          </Card>
        ) : (
          <EventTypesList active={active} archived={archived} />
        )}
      </div>
    </SnackbarProvider>
  );
}
