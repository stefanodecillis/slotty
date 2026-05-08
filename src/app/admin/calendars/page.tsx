/**
 * /admin/calendars — manage Google connections and per-calendar settings.
 *
 * Server component: lists ConnectedAccount rows + their Calendar children.
 * Each calendar gets two toggles (busy source / destination eligible) wired
 * through a tiny client component. No JS is needed for connect / disconnect /
 * resync — those are plain form POSTs.
 */
import { Link2, AlertCircle, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import { features } from '@/lib/env';
import { requireUserOrRedirect } from '@/lib/auth/session';

import { CalendarToggle } from './CalendarToggle';

export const dynamic = 'force-dynamic';

interface SearchParams {
  error?: string;
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string }> = {
    active: {
      label: 'Active',
      classes: 'bg-emerald-100 text-emerald-700',
    },
    needs_reauth: {
      label: 'Needs reauth',
      classes: 'bg-destructive/10 text-destructive',
    },
    disconnected: {
      label: 'Disconnected',
      classes: 'bg-card text-muted-foreground',
    },
  };
  const { label, classes } = map[status] ?? map.disconnected!;
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium font-medium ${classes}`}>
      {label}
    </span>
  );
}

function formatTimestamp(value: Date | null): string {
  if (!value) return 'never';
  const ms = Date.now() - value.getTime();
  if (ms < 0) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default async function CalendarsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fcalendars');

  const accounts = await db.connectedAccount.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      calendars: {
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
      },
    },
  });

  const googleConfigured = features.google();
  const errorMsg = searchParams?.error;

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Calendars</h1>
          <p className="mt-1 max-w-xl text-base text-muted-foreground">
            Connect Google accounts to read busy times and write new bookings. Slot
            calculation only uses calendars you mark as a busy source.
          </p>
        </div>
        <a href="/api/admin/calendars/connect">
          <Button
            disabled={!googleConfigured}
          >
            <Link2 className="h-4 w-4" />
            Connect Google account
          </Button>
        </a>
      </header>

      {errorMsg ? (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">
            Connection failed: <span className="font-mono">{errorMsg}</span>
          </p>
        </div>
      ) : null}

      {!googleConfigured ? (
        <div className="mb-6 rounded-lg border border-border bg-muted/50 p-5">
          <p className="text-sm text-muted-foreground">
            Google OAuth is not configured. Set{' '}
            <code className="rounded bg-card px-1.5 py-0.5 font-mono text-xs">
              SLOTTY_GOOGLE_CLIENT_ID
            </code>{' '}
            and{' '}
            <code className="rounded bg-card px-1.5 py-0.5 font-mono text-xs">
              SLOTTY_GOOGLE_CLIENT_SECRET
            </code>{' '}
            and restart.
          </p>
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/50 px-6 py-16 text-center">
          <CalendarDays className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">No calendars connected</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Connect a Google account to start receiving bookings on your real calendar.
          </p>
          {googleConfigured && (
            <a href="/api/admin/calendars/connect" className="mt-2">
              <Button>Connect Google account</Button>
            </a>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-10">
        {accounts.map((acc) => (
          <section key={acc.id}>
            <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground truncate">{acc.googleUserEmail}</h2>
                  <StatusChip status={acc.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Last sync: {formatTimestamp(acc.lastSyncedAt)}
                  {acc.lastSyncError ? (
                    <span className="text-destructive"> · last error: {acc.lastSyncError}</span>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {acc.status === 'needs_reauth' ? (
                  <a href="/api/admin/calendars/connect">
                    <Button variant="secondary" size="sm">
                      Reconnect
                    </Button>
                  </a>
                ) : null}
                <form method="POST" action="/api/admin/calendars/resync" className="inline">
                  <Button type="submit" variant="ghost" size="sm">
                    Resync now
                  </Button>
                </form>
                {acc.status !== 'disconnected' ? (
                  <form method="POST" action="/api/admin/calendars/disconnect" className="inline">
                    <input type="hidden" name="accountId" value={acc.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Disconnect
                    </Button>
                  </form>
                ) : null}
              </div>
            </header>

            {acc.calendars.length === 0 ? (
              <p className="text-sm text-muted-foreground">No calendars on this account.</p>
            ) : (
              <ul className="overflow-hidden rounded-lg border border-border bg-card">
                {acc.calendars.map((cal, idx) => (
                  <li
                    key={cal.id}
                    className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
                      idx > 0 ? 'border-t border-border' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: cal.backgroundColor ?? '#aaa' }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-base font-medium text-foreground">{cal.name}</span>
                          {cal.isPrimary ? (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                              Primary
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {cal.timezone ?? 'no timezone'} · synced {formatTimestamp(cal.lastIncrementalSyncAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                      <CalendarToggle
                        calendarId={cal.id}
                        field="isBusySource"
                        initialValue={cal.isBusySource}
                        label="Busy source"
                      />
                      <CalendarToggle
                        calendarId={cal.id}
                        field="isDestinationEligible"
                        initialValue={cal.isDestinationEligible}
                        label="Destination"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
