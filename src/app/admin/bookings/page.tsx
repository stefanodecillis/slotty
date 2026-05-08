import Link from 'next/link';
import { DateTime } from 'luxon';
import { Download, CalendarOff, Search, ChevronRight } from 'lucide-react';

import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';

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
    <div className="mx-auto flex max-w-4xl flex-col">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Bookings</h1>
          <p className="mt-1 text-base text-muted-foreground">
            {total === 0
              ? 'No bookings yet.'
              : `${total} total booking${total === 1 ? '' : 's'}${
                  totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''
                }.`}
          </p>
        </div>
        <a href={exportUrl} download>
          <Button variant="outline" type="button">
            <Download className="h-4 w-4" />
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
              icon="search"
              title="No bookings match your filters"
              description="Try widening the date range or clearing filters."
            />
          ) : (
            <EmptyState
              icon="calendar_off"
              title="No bookings yet"
              description="Once people book through your link, they'll show up here."
            />
          )
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {/* Header row — desktop only */}
            <div className="hidden border-b border-border bg-muted/50 px-5 py-3 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[1.6fr_1.6fr_1.4fr_auto_40px] md:gap-4">
              <span>When</span>
              <span>Booker</span>
              <span>Event type</span>
              <span>Status</span>
              <span aria-hidden="true" />
            </div>
            <ul className="flex flex-col">
              {rows.map((b) => {
                const start = DateTime.fromJSDate(b.startAt).setZone(user.timezone);
                const color = eventTypeColors.get(b.eventType.id) ?? '#888';
                return (
                  <li key={b.id} className="border-b border-border last:border-b-0">
                    <Link
                      href={`/admin/bookings/${b.id}`}
                      className="grid grid-cols-1 gap-2 px-5 py-4 transition-colors hover:bg-muted/50 md:grid-cols-[1.6fr_1.6fr_1.4fr_auto_40px] md:items-center md:gap-4"
                    >
                      <div className="flex flex-col">
                        <span className="text-base font-medium text-foreground">
                          {start.toLocaleString(DateTime.DATETIME_MED)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {b.bookerTimezone}
                        </span>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="truncate text-sm text-foreground">{b.bookerName}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {b.bookerEmail}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        />
                        <span className="truncate text-sm text-foreground">
                          {b.eventType.title}
                        </span>
                      </div>
                      <div>
                        <StatusPill status={b.status} noShow={b.noShow} needsSync={b.needsSync} />
                      </div>
                      <div className="hidden md:flex md:justify-end">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
          <span className="text-xs text-muted-foreground">
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
  if (status === 'cancelled') tags.push({ label: 'Cancelled', tone: 'bg-destructive/10 text-destructive' });
  else if (status === 'rescheduled') tags.push({ label: 'Rescheduled', tone: 'bg-emerald-100 text-emerald-700' });
  else tags.push({ label: 'Confirmed', tone: 'bg-secondary text-secondary-foreground' });
  if (noShow) tags.push({ label: 'No-show', tone: 'bg-destructive/10 text-destructive' });
  if (needsSync) tags.push({ label: 'Needs sync', tone: 'bg-emerald-100 text-emerald-700' });
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t.label}
          className={`rounded-full px-2 py-0.5 text-xs ${t.tone}`}
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
  const Icon = icon === 'search' ? Search : CalendarOff;
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/50 px-6 py-16 text-center">
      <Icon className="h-12 w-12 text-muted-foreground" />
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
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
      <Button variant="ghost" type="button" disabled>
        {label}
      </Button>
    );
  }
  return (
    <Link href={`/admin/bookings?${search}`}>
      <Button variant="ghost" type="button">
        {label}
      </Button>
    </Link>
  );
}
