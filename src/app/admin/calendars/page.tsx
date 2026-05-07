/**
 * /admin/calendars — manage Google connections and per-calendar settings.
 *
 * Server component: lists ConnectedAccount rows + their Calendar children.
 * Each calendar gets two toggles (busy source / destination eligible) wired
 * through a tiny client component. No JS is needed for connect / disconnect /
 * resync — those are plain form POSTs.
 */
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
      classes: 'bg-surface-container-high text-on-surface-variant',
    },
  };
  const { label, classes } = map[status] ?? map.disconnected!;
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-label-m font-medium ${classes}`}>
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
          <h1 className="text-display-s text-on-background">Calendars</h1>
          <p className="mt-1 max-w-xl text-body-l text-on-surface-variant">
            Connect Google accounts to read busy times and write new bookings. Slot
            calculation only uses calendars you mark as a busy source.
          </p>
        </div>
        <a href="/api/admin/calendars/connect">
          <Button
            variant="filled"
            disabled={!googleConfigured}
            leadingIcon={<span className="material-symbols-outlined">link</span>}
          >
            Connect Google account
          </Button>
        </a>
      </header>

      {errorMsg ? (
        <div className="mb-6 flex items-start gap-3 rounded-shape-md border border-error/40 bg-error-container/40 p-4">
          <span className="material-symbols-outlined text-error">error</span>
          <p className="text-body-m text-on-error-container">
            Connection failed: <span className="font-mono">{errorMsg}</span>
          </p>
        </div>
      ) : null}

      {!googleConfigured ? (
        <div className="mb-6 rounded-shape-md border border-outline-variant bg-surface-container-low p-5">
          <p className="text-body-m text-on-surface-variant">
            Google OAuth is not configured. Set{' '}
            <code className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-body-s">
              SLOTTY_GOOGLE_CLIENT_ID
            </code>{' '}
            and{' '}
            <code className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-body-s">
              SLOTTY_GOOGLE_CLIENT_SECRET
            </code>{' '}
            and restart.
          </p>
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-shape-md bg-surface-container-low px-6 py-16 text-center">
          <span className="material-symbols-outlined text-[48px] text-on-surface-variant">
            calendar_today
          </span>
          <h2 className="text-title-l text-on-surface">No calendars connected</h2>
          <p className="max-w-sm text-body-m text-on-surface-variant">
            Connect a Google account to start receiving bookings on your real calendar.
          </p>
          {googleConfigured && (
            <a href="/api/admin/calendars/connect" className="mt-2">
              <Button variant="filled">Connect Google account</Button>
            </a>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-10">
        {accounts.map((acc) => (
          <section key={acc.id}>
            <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-outline-variant pb-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-title-l text-on-surface truncate">{acc.googleUserEmail}</h2>
                  <StatusChip status={acc.status} />
                </div>
                <p className="mt-1 text-body-s text-on-surface-variant">
                  Last sync: {formatTimestamp(acc.lastSyncedAt)}
                  {acc.lastSyncError ? (
                    <span className="text-error"> · last error: {acc.lastSyncError}</span>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {acc.status === 'needs_reauth' ? (
                  <a href="/api/admin/calendars/connect">
                    <Button variant="tonal" size="sm">
                      Reconnect
                    </Button>
                  </a>
                ) : null}
                <form method="POST" action="/api/admin/calendars/resync" className="inline">
                  <Button type="submit" variant="text" size="sm">
                    Resync now
                  </Button>
                </form>
                {acc.status !== 'disconnected' ? (
                  <form method="POST" action="/api/admin/calendars/disconnect" className="inline">
                    <input type="hidden" name="accountId" value={acc.id} />
                    <Button type="submit" variant="outlined" size="sm">
                      Disconnect
                    </Button>
                  </form>
                ) : null}
              </div>
            </header>

            {acc.calendars.length === 0 ? (
              <p className="text-body-m text-on-surface-variant">No calendars on this account.</p>
            ) : (
              <ul className="overflow-hidden rounded-shape-md border border-outline-variant bg-surface">
                {acc.calendars.map((cal, idx) => (
                  <li
                    key={cal.id}
                    className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
                      idx > 0 ? 'border-t border-outline-variant' : ''
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
                          <span className="truncate text-title-m text-on-surface">{cal.name}</span>
                          {cal.isPrimary ? (
                            <span className="rounded-full bg-primary-container px-2 py-0.5 text-label-s text-on-primary-container">
                              Primary
                            </span>
                          ) : null}
                        </p>
                        <p className="text-body-s text-on-surface-variant">
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
