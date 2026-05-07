/**
 * /admin/calendars — manage Google connections and per-calendar settings.
 *
 * Server component: lists ConnectedAccount rows + their Calendar children.
 * Each calendar gets two toggles (busy source / destination eligible) wired
 * through a tiny client component. No JS is needed for connect / disconnect /
 * resync — those are plain form POSTs.
 */
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
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
      classes: 'bg-tertiary-container text-on-tertiary-container',
    },
    needs_reauth: {
      label: 'Needs reauth',
      classes: 'bg-error-container text-on-error-container',
    },
    disconnected: {
      label: 'Disconnected',
      classes: 'bg-surface-container-highest text-on-surface-variant',
    },
  };
  const { label, classes } = map[status] ?? map.disconnected!;
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-label-s font-medium ${classes}`}>
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
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-label-l text-on-surface-variant">Phase 3</p>
        <h1 className="text-display-s text-on-background">Calendars</h1>
        <p className="text-body-m text-on-surface-variant">
          Connect Google accounts to read busy times and write new bookings. Slot calculation only
          uses calendars marked as a busy source.
        </p>
      </header>

      {errorMsg ? (
        <Card variant="filled" className="border border-error/40 p-4">
          <p className="text-body-m text-on-error-container">
            Connection failed: <span className="font-mono">{errorMsg}</span>
          </p>
        </Card>
      ) : null}

      {!googleConfigured ? (
        <Card variant="outlined" className="p-4">
          <p className="text-body-m text-on-surface-variant">
            Google OAuth is not configured. Set{' '}
            <code className="rounded bg-surface-container-highest px-1 font-mono">
              SLOTTY_GOOGLE_CLIENT_ID
            </code>{' '}
            and{' '}
            <code className="rounded bg-surface-container-highest px-1 font-mono">
              SLOTTY_GOOGLE_CLIENT_SECRET
            </code>{' '}
            and restart.
          </p>
        </Card>
      ) : null}

      <div className="flex justify-end">
        <a href="/api/admin/calendars/connect">
          <Button variant="filled" disabled={!googleConfigured}>
            Connect Google account
          </Button>
        </a>
      </div>

      {accounts.length === 0 ? (
        <Card variant="outlined" className="p-8 text-center">
          <p className="text-body-l text-on-surface-variant">No calendars connected.</p>
          <p className="mt-2 text-body-m text-on-surface-variant">
            Connect a Google account to start receiving bookings.
          </p>
        </Card>
      ) : null}

      {accounts.map((acc) => (
        <Card key={acc.id} variant="elevated" className="flex flex-col gap-4 p-4">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-headline-s text-on-surface">{acc.googleUserEmail}</h2>
              <p className="text-body-s text-on-surface-variant">
                Last sync: {formatTimestamp(acc.lastSyncedAt)}
                {acc.lastSyncError ? (
                  <span className="text-error"> · last error: {acc.lastSyncError}</span>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusChip status={acc.status} />
              {acc.status === 'needs_reauth' ? (
                <a href="/api/admin/calendars/connect">
                  <Button variant="tonal" size="default">
                    Reconnect
                  </Button>
                </a>
              ) : null}
              <form method="POST" action="/api/admin/calendars/resync" className="inline">
                <Button type="submit" variant="text" size="default">
                  Resync now
                </Button>
              </form>
              {acc.status !== 'disconnected' ? (
                <form method="POST" action="/api/admin/calendars/disconnect" className="inline">
                  <input type="hidden" name="accountId" value={acc.id} />
                  <Button type="submit" variant="outlined" size="default">
                    Disconnect
                  </Button>
                </form>
              ) : null}
            </div>
          </header>

          {acc.calendars.length === 0 ? (
            <p className="text-body-s text-on-surface-variant">No calendars on this account.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-outline-variant">
              {acc.calendars.map((cal) => (
                <li key={cal.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    {cal.backgroundColor ? (
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: cal.backgroundColor }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <div>
                      <p className="text-title-m text-on-surface">
                        {cal.name}
                        {cal.isPrimary ? (
                          <span className="ml-2 rounded-full bg-primary-container px-2 py-0.5 text-label-s text-on-primary-container">
                            primary
                          </span>
                        ) : null}
                      </p>
                      <p className="text-body-s text-on-surface-variant">
                        {cal.timezone ?? 'no timezone'} · synced {formatTimestamp(cal.lastIncrementalSyncAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
                    <CalendarToggle
                      calendarId={cal.id}
                      field="isBusySource"
                      initialValue={cal.isBusySource}
                      label="Block busy"
                    />
                    <CalendarToggle
                      calendarId={cal.id}
                      field="isDestinationEligible"
                      initialValue={cal.isDestinationEligible}
                      label="Write bookings"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}
