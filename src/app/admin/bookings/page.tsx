import Link from 'next/link';
import { DateTime } from 'luxon';

import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/Button';
import { SnackbarProvider } from '@/components/ui/Snackbar';

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
    select: { id: true, title: true, color: true, archived: true },
    orderBy: { title: 'asc' },
  });
  const ownedIds = ownedEventTypes.map((e) => e.id);
  const eventTypeColors = new Map(ownedEventTypes.map((e) => [e.id, e.color]));

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
      include: { eventType: { select: { id: true, title: true, slug: true } } },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(status || eventTypeId || from || to || q);

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
    <SnackbarProvider>
      <div className="mx-auto flex max-w-4xl flex-col">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-display-s text-on-background">Bookings</h1>
            <p className="mt-1 text-body-l text-on-surface-variant">
              {total === 0
                ? 'No bookings yet.'
                : `${total} total booking${total === 1 ? '' : 's'}${
                    totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''
                  }.`}
            </p>
          </div>
          <a href={exportUrl} download>
            <Button variant="outlined" type="button" leadingIcon={<span className="material-symbols-outlined">download</span>}>
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

        <section className="mt-6">
          {rows.length === 0 ? (
            hasFilters ? (
              <EmptyState
                icon="search_off"
                title="No bookings match your filters"
                description="Try widening the date range or clearing filters."
              />
            ) : (
              <EmptyState
                icon="event_busy"
                title="No bookings yet"
                description="Once people book through your link, they'll show up here."
              />
            )
          ) : (
            <div className="overflow-hidden rounded-shape-md border border-outline-variant bg-surface">
              {/* Header row — desktop only */}
              <div className="hidden border-b border-outline-variant bg-surface-container-low px-5 py-3 text-label-m text-on-surface-variant md:grid md:grid-cols-[1.6fr_1.6fr_1.4fr_auto_40px] md:gap-4">
                <span>When</span>
                <span>Booker</span>
                <span>Event type</span>
                <span>Status</span>
                <span aria-hidden="true" />
              </div>
              <ul className="flex flex-col">
                {rows.map((b) => {
                  const start = DateTime.fromJSDate(b.startAt);
                  const color = eventTypeColors.get(b.eventType.id) ?? '#888';
                  return (
                    <li key={b.id} className="border-b border-outline-variant last:border-b-0">
                      <Link
                        href={`/admin/bookings/${b.id}`}
                        className="grid grid-cols-1 gap-2 px-5 py-4 transition-colors hover:bg-surface-container-low md:grid-cols-[1.6fr_1.6fr_1.4fr_auto_40px] md:items-center md:gap-4"
                      >
                        <div className="flex flex-col">
                          <span className="text-title-m text-on-surface">
                            {start.toLocaleString(DateTime.DATETIME_MED)}
                          </span>
                          <span className="text-body-s text-on-surface-variant">
                            {b.bookerTimezone}
                          </span>
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="truncate text-body-m text-on-surface">{b.bookerName}</span>
                          <span className="truncate text-body-s text-on-surface-variant">
                            {b.bookerEmail}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: color }}
                            aria-hidden="true"
                          />
                          <span className="truncate text-body-m text-on-surface">
                            {b.eventType.title}
                          </span>
                        </div>
                        <div>
                          <StatusPill status={b.status} noShow={b.noShow} needsSync={b.needsSync} />
                        </div>
                        <div className="hidden md:flex md:justify-end">
                          <span className="material-symbols-outlined text-on-surface-variant">
                            chevron_right
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {totalPages > 1 && (
          <nav className="mt-6 flex items-center justify-center gap-3">
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
    </SnackbarProvider>
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
  if (status === 'cancelled') tags.push({ label: 'Cancelled', tone: 'bg-error-container text-on-error-container' });
  else if (status === 'rescheduled') tags.push({ label: 'Rescheduled', tone: 'bg-tertiary-container text-on-tertiary-container' });
  else tags.push({ label: 'Confirmed', tone: 'bg-secondary-container text-on-secondary-container' });
  if (noShow) tags.push({ label: 'No-show', tone: 'bg-error-container text-on-error-container' });
  if (needsSync) tags.push({ label: 'Needs sync', tone: 'bg-tertiary-container text-on-tertiary-container' });
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

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-shape-md bg-surface-container-low px-6 py-16 text-center">
      <span className="material-symbols-outlined text-[48px] text-on-surface-variant">
        {icon}
      </span>
      <h2 className="text-title-l text-on-surface">{title}</h2>
      <p className="max-w-sm text-body-m text-on-surface-variant">{description}</p>
    </div>
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
