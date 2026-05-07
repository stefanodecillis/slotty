import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';

import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Snackbar } from '@/components/ui/Snackbar';

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
      eventType: { select: { id: true, title: true, slug: true, userId: true, questions: { orderBy: { position: 'asc' }, select: { id: true, label: true } } } },
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

  return (
    <Snackbar.Provider>
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Link href="/admin/bookings" className="text-body-s text-on-surface-variant hover:text-on-surface">
              {'← Back to bookings'}
            </Link>
            <h1 className="text-display-s text-on-background">{booking.eventType.title}</h1>
            <p className="text-body-m text-on-surface-variant">
              {DateTime.fromJSDate(booking.startAt).toLocaleString(DateTime.DATETIME_MED)} –
              {' '}
              {DateTime.fromJSDate(booking.endAt).toLocaleString(DateTime.TIME_SIMPLE)}
            </p>
          </div>
          {!isCancelled && (
            <BookingAdminActions
              bookingId={booking.id}
              noShow={booking.noShow}
            />
          )}
        </header>

        <Card variant="filled">
          <Card.Header>
            <h2 className="text-title-m text-on-surface">Booker</h2>
          </Card.Header>
          <Card.Content className="flex flex-col gap-2">
            <p className="text-body-m text-on-surface">
              {booking.bookerName} &lt;{booking.bookerEmail}&gt;
            </p>
            <p className="text-body-s text-on-surface-variant">
              Timezone: {booking.bookerTimezone}
            </p>
            {additionalGuests.length > 0 && (
              <p className="text-body-m text-on-surface">
                <span className="text-on-surface-variant">Guests: </span>
                {additionalGuests.join(', ')}
              </p>
            )}
            {booking.notes && (
              <p className="whitespace-pre-wrap text-body-m text-on-surface">
                <span className="text-on-surface-variant">Notes: </span>
                {booking.notes}
              </p>
            )}
            {booking.eventType.questions.length > 0 && (
              <div className="flex flex-col gap-1">
                {booking.eventType.questions.map((q) => {
                  const a = answers[q.id];
                  if (!a) return null;
                  return (
                    <p key={q.id} className="text-body-m text-on-surface">
                      <span className="text-on-surface-variant">{q.label}: </span>
                      {a}
                    </p>
                  );
                })}
              </div>
            )}
          </Card.Content>
        </Card>

        <Card variant="outlined">
          <Card.Header>
            <h2 className="text-title-m text-on-surface">Calendar</h2>
          </Card.Header>
          <Card.Content className="flex flex-col gap-2 text-body-m text-on-surface">
            <p>
              <span className="text-on-surface-variant">Status: </span>
              {booking.status}
              {booking.noShow && (
                <span className="ml-2 rounded-full bg-error-container px-2 py-0.5 text-label-s text-on-error-container">
                  no-show
                </span>
              )}
              {booking.needsSync && (
                <span className="ml-2 rounded-full bg-tertiary-container px-2 py-0.5 text-label-s text-on-tertiary-container">
                  needs sync
                </span>
              )}
            </p>
            <p>
              <span className="text-on-surface-variant">Google account: </span>
              {booking.googleAccount.googleUserEmail}
            </p>
            <p>
              <span className="text-on-surface-variant">Google event id: </span>
              <code className="text-body-s">{booking.googleEventId ?? '—'}</code>
            </p>
            {booking.meetingUrl && (
              <p>
                <span className="text-on-surface-variant">Meeting URL: </span>
                <a className="text-primary underline" href={booking.meetingUrl} target="_blank" rel="noreferrer">
                  {booking.meetingUrl}
                </a>
              </p>
            )}
            {booking.syncError && (
              <p className="text-body-s text-error">Sync error: {booking.syncError}</p>
            )}
            {isCancelled && (
              <>
                <p>
                  <span className="text-on-surface-variant">Cancelled at: </span>
                  {booking.cancelledAt
                    ? DateTime.fromJSDate(booking.cancelledAt).toLocaleString(DateTime.DATETIME_MED)
                    : '—'}
                </p>
                {booking.cancelReason && (
                  <p>
                    <span className="text-on-surface-variant">Reason: </span>
                    {booking.cancelReason}
                  </p>
                )}
              </>
            )}
          </Card.Content>
        </Card>

        <Card variant="outlined">
          <Card.Header>
            <h2 className="text-title-m text-on-surface">History</h2>
          </Card.Header>
          <Card.Content>
            {booking.history.length === 0 ? (
              <p className="text-body-s text-on-surface-variant">No events recorded.</p>
            ) : (
              <ol className="flex flex-col gap-2 text-body-s">
                {booking.history.map((h) => (
                  <li key={h.id} className="flex flex-col gap-0.5 border-b border-outline-variant pb-2 last:border-b-0">
                    <p className="text-on-surface">
                      <span className="font-medium">{h.action}</span>
                      <span className="text-on-surface-variant"> · by {h.actor}</span>
                    </p>
                    <p className="text-on-surface-variant">
                      {DateTime.fromJSDate(h.createdAt).toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS)}
                    </p>
                    {h.payloadJson && h.payloadJson !== '{}' && (
                      <pre className="overflow-x-auto rounded-shape-xs bg-surface-container-low p-2 text-body-s text-on-surface-variant">
                        {h.payloadJson}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card.Content>
        </Card>

        <div className="flex gap-2">
          <Link href="/admin/bookings">
            <Button variant="text" type="button">
              Back
            </Button>
          </Link>
        </div>
      </div>
    </Snackbar.Provider>
  );
}
