import Link from 'next/link';
import { DateTime } from 'luxon';
import { ChevronRight, Calendar, Plus, ExternalLink } from 'lucide-react';
import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

type ConnectedAccount = {
  id: string;
  googleUserEmail: string;
  status: string;
  lastSyncedAt: Date | null;
};

function syncHealthColor(account: ConnectedAccount): 'green' | 'yellow' | 'red' {
  if (account.status !== 'active') return 'red';
  if (!account.lastSyncedAt) return 'yellow';
  const diffMs = Date.now() - account.lastSyncedAt.getTime();
  const diffH = diffMs / 3_600_000;
  if (diffH < 1) return 'green';
  if (diffH < 24) return 'yellow';
  return 'red';
}

export default async function AdminDashboardPage() {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin');

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);
  const weekStart = new Date(todayStart.getTime() - todayStart.getDay() * 86_400_000);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 86_400_000);
  const next7End = new Date(todayStart.getTime() + 7 * 86_400_000);

  const ownedEventTypeIds = await db.eventType
    .findMany({ where: { userId: user.id }, select: { id: true } })
    .then((rows) => rows.map((r) => r.id));

  const [
    todayCount,
    thisWeekCount,
    lastWeekCount,
    next7Count,
    upcomingBookings,
    connectedAccounts,
  ] = await Promise.all([
    db.booking.count({
      where: {
        eventTypeId: { in: ownedEventTypeIds },
        startAt: { gte: todayStart, lt: todayEnd },
        status: { not: 'cancelled' },
      },
    }),
    db.booking.count({
      where: {
        eventTypeId: { in: ownedEventTypeIds },
        startAt: { gte: weekStart, lt: weekEnd },
        status: { not: 'cancelled' },
      },
    }),
    db.booking.count({
      where: {
        eventTypeId: { in: ownedEventTypeIds },
        startAt: { gte: prevWeekStart, lt: weekStart },
        status: { not: 'cancelled' },
      },
    }),
    db.booking.count({
      where: {
        eventTypeId: { in: ownedEventTypeIds },
        startAt: { gte: now, lt: next7End },
        status: { not: 'cancelled' },
      },
    }),
    db.booking.findMany({
      where: {
        eventTypeId: { in: ownedEventTypeIds },
        startAt: { gte: now },
        status: { not: 'cancelled' },
      },
      orderBy: { startAt: 'asc' },
      take: 5,
      include: { eventType: { select: { title: true, color: true } } },
    }),
    db.connectedAccount.findMany({
      select: { id: true, googleUserEmail: true, status: true, lastSyncedAt: true },
    }),
  ]);

  const weekChangePct =
    lastWeekCount === 0
      ? thisWeekCount > 0
        ? 100
        : 0
      : Math.round(((thisWeekCount - lastWeekCount) / lastWeekCount) * 100);

  // Aggregate sync health: worst color wins.
  const syncStatus = (() => {
    if (connectedAccounts.length === 0) {
      return { tone: 'yellow' as const, label: 'No calendars connected' };
    }
    const colors = connectedAccounts.map(syncHealthColor);
    if (colors.includes('red')) return { tone: 'red' as const, label: 'Needs attention' };
    if (colors.includes('yellow')) return { tone: 'yellow' as const, label: 'Stale sync' };
    return { tone: 'green' as const, label: 'All systems go' };
  })();

  const firstName = user.displayName.split(' ')[0] ?? user.username;

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <header className="mb-10">
        <p className="text-sm font-medium text-muted-foreground">
          {DateTime.now().toLocaleString(DateTime.DATE_FULL)}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
          Welcome back, {firstName}
        </h1>
      </header>

      {/* Stat tiles */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatTile label="Today" value={todayCount} hint={todayCount === 0 ? 'No bookings' : `Across ${ownedEventTypeIds.length} event type${ownedEventTypeIds.length === 1 ? '' : 's'}`} />
        <StatTile
          label="This week"
          value={thisWeekCount}
          delta={
            weekChangePct === 0
              ? null
              : { pct: weekChangePct, positive: weekChangePct >= 0 }
          }
          hint={`vs ${lastWeekCount} last week`}
        />
        <StatTile label="Next 7 days" value={next7Count} hint="Confirmed bookings" />
        <SyncTile tone={syncStatus.tone} label={syncStatus.label} />
      </section>

      {/* Upcoming bookings */}
      <section className="mt-12">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Upcoming bookings</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The next five confirmed bookings on your calendar.
            </p>
          </div>
          <Link
            href="/admin/bookings"
            className="text-sm font-medium text-primary hover:underline"
          >
            View all
          </Link>
        </div>

        {upcomingBookings.length === 0 ? (
          <EmptyState
            title="No upcoming bookings"
            description="Once people book through your link, they'll show up here."
            cta={{ label: 'Share your booking page', href: `/${user.username}` }}
          />
        ) : (
          <div className="rounded-lg border border-border bg-card">
            {upcomingBookings.map((b, idx) => {
              const dt = DateTime.fromJSDate(b.startAt);
              return (
                <Link
                  key={b.id}
                  href={`/admin/bookings/${b.id}`}
                  className={`flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/50 ${
                    idx > 0 ? 'border-t border-border' : ''
                  }`}
                >
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md bg-muted/50 text-foreground">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      {dt.toFormat('MMM')}
                    </span>
                    <span className="text-base font-medium">{dt.toFormat('d')}</span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base font-medium text-foreground">
                      {b.bookerName}
                    </span>
                    <span className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: b.eventType.color }}
                      />
                      <span className="truncate">{b.eventType.title}</span>
                    </span>
                  </div>
                  <div className="hidden text-right text-xs text-muted-foreground sm:block">
                    {dt.toFormat('h:mm a')}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Quick actions */}
      <section className="mt-12">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Quick actions</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <QuickLink
            icon={<Calendar className="h-5 w-5" />}
            title="Connect a calendar"
            description="Sync Google Calendar"
            href="/admin/calendars"
          />
          <QuickLink
            icon={<Plus className="h-5 w-5" />}
            title="New event type"
            description="Define a bookable offering"
            href="/admin/event-types/new"
          />
          <QuickLink
            icon={<ExternalLink className="h-5 w-5" />}
            title="Public profile"
            description={`/${user.username}`}
            href={`/${user.username}`}
            external
          />
        </div>
      </section>
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: number;
  hint?: string;
  delta?: { pct: number; positive: boolean } | null;
}

function StatTile({ label, value, hint, delta }: StatTileProps) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-card p-5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-4xl tracking-tight leading-none text-foreground">{value}</p>
        {delta && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              delta.positive
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {delta.positive ? '+' : ''}
            {delta.pct}%
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SyncTile({ tone, label }: { tone: 'green' | 'yellow' | 'red'; label: string }) {
  const dot =
    tone === 'green' ? 'bg-emerald-600' : tone === 'yellow' ? 'bg-yellow-500' : 'bg-destructive';
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-card p-5">
      <p className="text-sm font-medium text-muted-foreground">Sync health</p>
      <div className="flex items-center gap-2 pt-3">
        <span className={`h-3 w-3 shrink-0 rounded-full ${dot}`} />
        <p className="text-base font-medium text-foreground">{label}</p>
      </div>
      <Link
        href="/admin/calendars"
        className="mt-2 self-start text-xs font-medium text-primary hover:underline"
      >
        Manage calendars
      </Link>
    </div>
  );
}

interface QuickLinkProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  external?: boolean;
}

function QuickLink({ icon, title, description, href, external }: QuickLinkProps) {
  return (
    <Link
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="group flex items-start gap-3 rounded-lg bg-muted/50 p-5 transition-colors hover:bg-muted"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-base font-medium text-foreground">
          {title}
          {external && (
            <ExternalLink className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  cta?: { label: string; href: string };
}

function EmptyState({ title, description, cta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/50 py-16 px-6 text-center">
      <Calendar className="h-12 w-12 text-muted-foreground" />
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
