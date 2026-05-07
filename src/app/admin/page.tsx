import Link from 'next/link';
import { DateTime } from 'luxon';
import { Card } from '@/components/ui/Card';
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

  const ownedEventTypeIds = await db.eventType
    .findMany({ where: { userId: user.id }, select: { id: true } })
    .then((rows) => rows.map((r) => r.id));

  const [
    todayBookings,
    todayCount,
    thisWeekCount,
    lastWeekCount,
    upcomingBookings,
    connectedAccounts,
  ] = await Promise.all([
    db.booking.findMany({
      where: {
        eventTypeId: { in: ownedEventTypeIds },
        startAt: { gte: now, lt: todayEnd },
        status: { not: 'cancelled' },
      },
      orderBy: { startAt: 'asc' },
      take: 3,
      include: { eventType: { select: { title: true } } },
    }),
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
    db.booking.findMany({
      where: {
        eventTypeId: { in: ownedEventTypeIds },
        startAt: { gte: todayEnd },
        status: { not: 'cancelled' },
      },
      orderBy: { startAt: 'asc' },
      take: 5,
      include: { eventType: { select: { title: true } } },
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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-display-s text-on-surface">Welcome, {user.displayName}</h1>
        <p className="text-body-m text-on-surface-variant">
          {DateTime.now().toLocaleString(DateTime.DATE_FULL)}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Today's bookings */}
        <Card variant="filled" className="flex flex-col gap-2 p-4">
          <p className="text-label-l text-on-surface-variant">Today's bookings</p>
          <p className="text-display-s text-on-surface">{todayCount}</p>
          {todayBookings.length === 0 ? (
            <p className="text-body-s text-on-surface-variant">No upcoming bookings today.</p>
          ) : (
            <ul className="flex flex-col gap-2 pt-1">
              {todayBookings.map((b) => (
                <li key={b.id} className="flex flex-col gap-0.5 rounded-shape-xs bg-surface-container p-2 text-body-s">
                  <span className="text-label-m text-on-surface">
                    {DateTime.fromJSDate(b.startAt).toLocaleString(DateTime.TIME_SIMPLE)} — {b.bookerName}
                  </span>
                  <span className="text-on-surface-variant">{b.eventType.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* This week */}
        <Card variant="filled" className="flex flex-col gap-2 p-4">
          <p className="text-label-l text-on-surface-variant">This week</p>
          <p className="text-display-s text-on-surface">{thisWeekCount}</p>
          <p className="text-body-s text-on-surface-variant">
            {weekChangePct >= 0 ? '+' : ''}{weekChangePct}% vs last week ({lastWeekCount})
          </p>
        </Card>

        {/* Upcoming */}
        <Card variant="filled" className="flex flex-col gap-2 p-4">
          <p className="text-label-l text-on-surface-variant">Upcoming</p>
          {upcomingBookings.length === 0 ? (
            <p className="text-body-s text-on-surface-variant">No upcoming bookings.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {upcomingBookings.map((b) => (
                <li key={b.id} className="flex flex-col gap-0.5 rounded-shape-xs bg-surface-container p-2 text-body-s">
                  <span className="text-label-m text-on-surface">
                    {DateTime.fromJSDate(b.startAt).toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY)}
                  </span>
                  <span className="text-on-surface-variant">
                    {b.bookerName} — {b.eventType.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Sync health */}
        <Card variant="filled" className="flex flex-col gap-2 p-4">
          <p className="text-label-l text-on-surface-variant">Calendar sync</p>
          {connectedAccounts.length === 0 ? (
            <p className="text-body-s text-on-surface-variant">
              No calendars connected.{' '}
              <Link href="/admin/calendars" className="underline">
                Connect one
              </Link>
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {connectedAccounts.map((acct) => {
                const color = syncHealthColor(acct);
                const dot =
                  color === 'green'
                    ? 'bg-green-500'
                    : color === 'yellow'
                      ? 'bg-yellow-500'
                      : 'bg-error';
                const label =
                  color === 'green'
                    ? 'Synced'
                    : color === 'yellow'
                      ? 'Synced (stale)'
                      : acct.status === 'needs_reauth'
                        ? 'Needs re-auth'
                        : 'Not synced';
                return (
                  <li key={acct.id} className="flex items-center gap-2 text-body-s">
                    <span className={`h-2 w-2 rounded-full ${dot}`} />
                    <span className="text-on-surface">{acct.googleUserEmail}</span>
                    <span className="text-on-surface-variant">— {label}</span>
                    {acct.lastSyncedAt && (
                      <span className="text-on-surface-variant text-body-xs ml-auto">
                        {DateTime.fromJSDate(acct.lastSyncedAt).toRelative()}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Quick actions */}
      <Card variant="filled" className="p-4">
        <p className="text-label-l text-on-surface-variant mb-3">Quick actions</p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/calendars"
            className="inline-flex items-center gap-2 rounded-shape-m bg-secondary-container px-4 py-2 text-label-l text-on-secondary-container transition-opacity hover:opacity-80"
          >
            <span className="material-symbols-outlined text-base">calendar_today</span>
            Connect calendar
          </Link>
          <Link
            href="/admin/event-types"
            className="inline-flex items-center gap-2 rounded-shape-m bg-secondary-container px-4 py-2 text-label-l text-on-secondary-container transition-opacity hover:opacity-80"
          >
            <span className="material-symbols-outlined text-base">add</span>
            Create event type
          </Link>
          <Link
            href={`/${user.username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-shape-m bg-secondary-container px-4 py-2 text-label-l text-on-secondary-container transition-opacity hover:opacity-80"
          >
            <span className="material-symbols-outlined text-base">open_in_new</span>
            View public profile
          </Link>
        </div>
      </Card>
    </div>
  );
}
