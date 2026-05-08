import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { getPublicUrl } from '@/lib/site-url/store';
import { Button } from '@/components/ui/button';
import { CalendarPlus, Plus } from 'lucide-react';
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
    <div className="mx-auto flex max-w-4xl flex-col">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Event types</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Bookable offerings on your public profile.
          </p>
        </div>
        <Link href="/admin/event-types/new">
          <Button>
            <Plus className="h-4 w-4" />
            New event type
          </Button>
        </Link>
      </header>

      {active.length === 0 && archived.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/50 px-6 py-16 text-center">
          <CalendarPlus className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">No event types yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create your first bookable offering — a 30-minute intro call, a coaching session,
            whatever you offer.
          </p>
          <Link href="/admin/event-types/new" className="mt-2">
            <Button>Create event type</Button>
          </Link>
        </div>
      ) : (
        <EventTypesList
          active={active}
          archived={archived}
          siteUrl={await getPublicUrl()}
        />
      )}
    </div>
  );
}
