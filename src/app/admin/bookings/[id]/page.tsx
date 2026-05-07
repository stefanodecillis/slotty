import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';

import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/Button';
import { SnackbarProvider } from '@/components/ui/Snackbar';

import { BookingAdminActions } from '../_components/booking-admin-actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

function safeJsonObject(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function safeJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export default async function AdminBookingDetailPage({ params }: PageProps) {
  const user = await requireUserOrRedirect(`/admin/login?next=%2Fadmin%2Fbookings%2F${params.id}`);

  const booking = await db.booking.findUnique({
    where: { id: params.id },
    include: {
      eventType: { select: { id: true, title: true, slug: true, color: true, userId: true, questions: { orderBy: { position: 'asc' }, select: { id: true, label: true } } } },
      googleAccount: { select: { googleUserEmail: true } },
      history: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!booking || booking.eventType.userId !== user.id) notFound();

  const additionalGuests = safeJsonArray(booking.additionalGuestsJson);
  const answers = Object.fromEntries(
    Object.entries(safeJsonObject(booking.answersJson)).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
  );
  const isCancelled = booking.status === 'cancelled';
  const start = DateTime.fromJSDate(booking.startAt);
  const end = DateTime.fromJSDate(booking.endAt);

  return (
    <SnackbarProvider>
      <div className="mx-auto flex max-w-4xl flex-col">
        <Link
          href="/admin/bookings"
          className="mb-4 inline-flex w-fit items-center gap-1 text-label-l text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back to bookings
        </Link>

        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: booking.eventType.color }}
                aria-hidden="true"
              />
              <p className="text-label-l text-on-surface-variant">{booking.eventType.title}</p>
            </div>
            <h1 className="mt-1 text-display-s text-on-background">{booking.bookerName}</h1>
            <p className="mt-1 text-body-l text-on-surface-variant">
              {start.toLocaleString(DateTime.DATETIME_FULL)} –{' '}
              {end.toLocaleString(DateTime.TIME_SIMPLE)}
            </p>
          </div>
          {!isCancelled && (
            <BookingAdminActions
              bookingId={booking.id}
              noShow={booking.noShow}
            />
          )}
        </header>

        {/* Status row */}
        <section className="mb-8 flex flex-wrap items-center gap-2">
          <StatusChip
            label={
              isCancelled
                ? 'Cancelled'
                : booking.status === 'rescheduled'
                  ? 'Rescheduled'
                  : 'Confirmed'
            }
            tone={isCancelled ? 'error' : booking.status === 'rescheduled' ? 'tertiary' : 'secondary'}
          />
          {booking.noShow && <StatusChip label="No-show" tone="error" />}
          {booking.needsSync && <StatusChip label="Needs sync" tone="tertiary" />}
        </section>

        {/* Booker section */}
        <section>
          <h2 className="mb-3 text-title-l text-on-surface">Booker</h2>
          <div className="rounded-shape-md bg-surface-container-low p-6">
            <DetailRow label="Name" value={booking.bookerName} />
            <DetailRow label="Email" value={<a href={`mailto:${booking.bookerEmail}`} className="text-primary hover:underline">{booking.bookerEmail}</a>} />
            <DetailRow label="Timezone" value={booking.bookerTimezone} />
            {additionalGuests.length > 0 && (
              <DetailRow label="Guests" value={additionalGuests.join(', ')} />
            )}
            {booking.notes && (
              <DetailRow
                label="Notes"
                value={<p className="whitespace-pre-wrap">{booking.notes}</p>}
              />
            )}
            {booking.eventType.questions.length > 0 &&
              booking.eventType.questions.map((q) => {
                const a = answers[q.id];
                if (!a) return null;
                return <DetailRow key={q.id} label={q.label} value={a} />;
              })}
          </div>
        </section>

        {/* Calendar section */}
        <section className="mt-8">
          <h2 className="mb-3 text-title-l text-on-surface">Calendar</h2>
          <div className="rounded-shape-md bg-surface-container-low p-6">
            <DetailRow label="Google account" value={booking.googleAccount.googleUserEmail} />
            <DetailRow
              label="Google event ID"
              value={
                <code className="rounded bg-surface-container-high px-2 py-0.5 text-body-s">
                  {booking.googleEventId ?? '—'}
                </code>
              }
            />
            {booking.meetingUrl && (
              <DetailRow
                label="Meeting URL"
                value={
                  <a
                    className="text-primary hover:underline"
                    href={booking.meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {booking.meetingUrl}
                  </a>
                }
              />
            )}
            {booking.syncError && (
              <DetailRow label="Sync error" value={<span className="text-error">{booking.syncError}</span>} />
            )}
            {isCancelled && (
              <>
                <DetailRow
                  label="Cancelled at"
                  value={
                    booking.cancelledAt
                      ? DateTime.fromJSDate(booking.cancelledAt).toLocaleString(DateTime.DATETIME_MED)
                      : '—'
                  }
                />
                {booking.cancelReason && (
                  <DetailRow label="Reason" value={booking.cancelReason} />
                )}
              </>
            )}
          </div>
        </section>

        {/* History section */}
        <section className="mt-8">
          <h2 className="mb-3 text-title-l text-on-surface">History</h2>
          {booking.history.length === 0 ? (
            <p className="rounded-shape-md bg-surface-container-low p-6 text-body-m text-on-surface-variant">
              No events recorded yet.
            </p>
          ) : (
            <ol className="rounded-shape-md bg-surface-container-low">
              {booking.history.map((h, idx) => (
                <li
                  key={h.id}
                  className={`flex flex-col gap-1 px-6 py-4 ${
                    idx > 0 ? 'border-t border-outline-variant' : ''
                  }`}
                >
                  <p className="text-title-m text-on-surface">{h.action}</p>
                  <p className="text-body-s text-on-surface-variant">
                    {DateTime.fromJSDate(h.createdAt).toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS)} · by {h.actor}
                  </p>
                  {h.payloadJson && h.payloadJson !== '{}' && (
                    <pre className="mt-1 overflow-x-auto rounded-shape-xs bg-surface-container p-3 text-body-s text-on-surface-variant">
                      {h.payloadJson}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </SnackbarProvider>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-outline-variant py-3 first:pt-0 last:border-b-0 last:pb-0 sm:flex-row sm:gap-4">
      <span className="shrink-0 text-label-l text-on-surface-variant sm:w-40 sm:py-0.5">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-body-m text-on-surface">{value}</span>
    </div>
  );
}

function StatusChip({ label, tone }: { label: string; tone: 'secondary' | 'tertiary' | 'error' }) {
  const tones: Record<string, string> = {
    secondary: 'bg-secondary-container text-on-secondary-container',
    tertiary: 'bg-tertiary-container text-on-tertiary-container',
    error: 'bg-error-container text-on-error-container',
  };
  return (
    <span className={`rounded-full px-3 py-1 text-label-m ${tones[tone]}`}>{label}</span>
  );
}
