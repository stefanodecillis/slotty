import Link from 'next/link';
import { DateTime } from 'luxon';

import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Snackbar } from '@/components/ui/Snackbar';

import { BookingsFilters } from './_components/bookings-filters';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: {
    status?: string;
    eventTypeId?: string;
    from?: string;
    to?: string;
    q?: string;
    page?: string;
  };
}

const PAGE_SIZE = 50;

/**
 * Admin booking list. Filterable by status, event type, date range, search.
 * Server-side pagination via `?page=` (offset-based — bookings volume is
 * single-user-app-sized so we don't need cursors at this UI layer).
 */
export default async function AdminBookingsPage({ searchParams }: PageProps) {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fbookings');

  const ownedEventTypes = await db.eventType.findMany({
    where: { userId: user.id },
    select: { id: true, title: true, archived: true },
    orderBy: { title: 'asc' },
  });
  const ownedIds = ownedEventTypes.map((e) => e.id);

  const status = searchParams.status ?? '';
  const eventTypeId = searchParams.eventTypeId ?? '';
  const from = searchParams.from ?? '';
  const to = searchParams.to ?? '';
  const q = searchParams.q ?? '';
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  type BookingWhere = NonNullable<Parameters<typeof db.booking.findMany>[0]>['where'];
  const where: BookingWhere = ownedIds.length === 0
    ? { id: '__never__' }
    : {
        eventTypeId: eventTypeId && ownedIds.includes(eventTypeId) ? eventTypeId : { in: ownedIds },
      };
  if (status) (where as { status?: string }).status = status;
  if (from || to) {
    (where as { startAt?: { gte?: Date; lte?: Date } }).startAt = {};
    if (from) (where as { startAt: { gte?: Date } }).startAt!.gte = new Date(from);
    if (to) (where as { startAt: { lte?: Date } }).startAt!.lte = new Date(to);
  }
  if (q) {
    (where as { OR?: unknown[] }).OR = [
      { bookerName: { contains: q } },
      { bookerEmail: { contains: q } },
    ];
  }

  const [total, rows] = await Promise.all([
    db.booking.count({ where }),
    db.booking.findMany({
      where,
      orderBy: { startAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { eventType: { select: { title: true, slug: true } } },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Build the export URL with current filters preserved.
  const exportParams = new URLSearchParams();
  if (status) exportParams.set('status', status);
  if (eventTypeId) exportParams.set('eventTypeId', eventTypeId);
  if (from) exportParams.set('from', from);
  if (to) exportParams.set('to', to);
  if (q) exportParams.set('q', q);
  const exportUrl = `/api/admin/bookings/export.csv${
    exportParams.toString() ? `?${exportParams}` : ''
  }`;

  return (
    <Snackbar.Provider>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex items-start justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-label-l text-on-surface-variant">Bookings</p>
            <h1 className="text-display-s text-on-background">All bookings</h1>
            <p className="text-body-m text-on-surface-variant">
              {total} total · page {page} of {totalPages}
            </p>
          </div>
          <a href={exportUrl} download>
            <Button variant="outlined" type="button">
              Export CSV
            </Button>
          </a>
        </header>

        <BookingsFilters
          status={status}
          eventTypeId={eventTypeId}
          from={from}
          to={to}
          q={q}
          eventTypes={ownedEventTypes}
        />

        <Card variant="outlined">
          <Card.Content className="overflow-x-auto p-0">
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-body-m text-on-surface-variant">
                No bookings match your filters.
              </p>
            ) : (
              <table className="min-w-full text-body-s">
                <thead className="bg-surface-container-low text-label-m text-on-surface-variant">
                  <tr>
                    <th className="px-4 py-3 text-left">When</th>
                    <th className="px-4 py-3 text-left">Event Type</th>
                    <th className="px-4 py-3 text-left">Booker</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => {
                    const start = DateTime.fromJSDate(b.startAt);
                    return (
                      <tr key={b.id} className="border-t border-outline-variant">
                        <td className="px-4 py-3 text-on-surface">
                          {start.toLocaleString(DateTime.DATETIME_MED)}
                          <br />
                          <span className="text-body-s text-on-surface-variant">
                            {b.bookerTimezone}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-on-surface">{b.eventType.title}</td>
                        <td className="px-4 py-3 text-on-surface">
                          {b.bookerName}
                          <br />
                          <span className="text-body-s text-on-surface-variant">
                            {b.bookerEmail}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-on-surface">
                          <StatusPill status={b.status} noShow={b.noShow} needsSync={b.needsSync} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/admin/bookings/${b.id}`}>
                            <Button variant="text" type="button">
                              View
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card.Content>
        </Card>

        {totalPages > 1 && (
          <nav className="flex items-center justify-center gap-2">
            <PageLink
              label="Previous"
              page={page - 1}
              disabled={page <= 1}
              params={searchParams}
            />
            <span className="text-body-s text-on-surface-variant">
              {page} / {totalPages}
            </span>
            <PageLink
              label="Next"
              page={page + 1}
              disabled={page >= totalPages}
              params={searchParams}
            />
          </nav>
        )}
      </div>
    </Snackbar.Provider>
  );
}

function StatusPill({
  status,
  noShow,
  needsSync,
}: {
  status: string;
  noShow: boolean;
  needsSync: boolean;
}) {
  const tags: { label: string; tone: string }[] = [];
  if (status === 'cancelled') tags.push({ label: 'cancelled', tone: 'bg-error-container text-on-error-container' });
  else if (status === 'rescheduled') tags.push({ label: 'rescheduled', tone: 'bg-tertiary-container text-on-tertiary-container' });
  else tags.push({ label: 'confirmed', tone: 'bg-secondary-container text-on-secondary-container' });
  if (noShow) tags.push({ label: 'no-show', tone: 'bg-error-container text-on-error-container' });
  if (needsSync) tags.push({ label: 'needs sync', tone: 'bg-tertiary-container text-on-tertiary-container' });
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t.label}
          className={`rounded-full px-2 py-0.5 text-label-s ${t.tone}`}
        >
          {t.label}
        </span>
      ))}
    </span>
  );
}

function PageLink({
  label,
  page,
  disabled,
  params,
}: {
  label: string;
  page: number;
  disabled: boolean;
  params: PageProps['searchParams'];
}) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && k !== 'page') search.set(k, v);
  }
  search.set('page', String(page));
  if (disabled) {
    return (
      <Button variant="text" type="button" disabled>
        {label}
      </Button>
    );
  }
  return (
    <Link href={`/admin/bookings?${search}`}>
      <Button variant="text" type="button">
        {label}
      </Button>
    </Link>
  );
}
