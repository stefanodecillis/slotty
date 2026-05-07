import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';

import { db } from '@/lib/db';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { verifyBookingToken } from '@/lib/booking/tokens';

import { BookingActions } from './_components/booking-actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { bookingId: string };
  searchParams: { t?: string };
}

interface BookingViewModel {
  id: string;
  eventTitle: string;
  startAt: Date;
  endAt: Date;
  status: string;
  bookerName: string;
  bookerEmail: string;
  bookerTimezone: string;
  additionalGuests: string[];
  notes: string | null;
  meetingUrl: string | null;
  needsSync: boolean;
  cancelledAt: Date | null;
  cancelReason: string | null;
  questions: Array<{ id: string; label: string }>;
  answers: Record<string, string>;
}

function safeParseObject(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function safeParseArray(s: string | null | undefined): unknown[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function formatRange(start: Date, end: Date, tz: string): { line: string; tzLabel: string; utc: string } {
  const tzStart = DateTime.fromJSDate(start, { zone: 'utc' }).setZone(tz);
  const tzEnd = DateTime.fromJSDate(end, { zone: 'utc' }).setZone(tz);
  const date = tzStart.toLocaleString({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const startLabel = tzStart.toFormat('HH:mm');
  const endLabel = tzEnd.toFormat('HH:mm');
  const utc = `${DateTime.fromJSDate(start, { zone: 'utc' }).toFormat('HH:mm')}–${DateTime.fromJSDate(end, { zone: 'utc' }).toFormat('HH:mm')} UTC`;
  return { line: `${date} · ${startLabel}–${endLabel}`, tzLabel: tz, utc };
}

/**
 * Public booking confirmation/management page.
 *
 * If `?t=<token>` is provided and matches one of the stored token hashes, the
 * full management view is rendered (cancel + reschedule + ICS download with
 * token-protected URLs). Otherwise we render a read-only summary so a stale
 * email link still tells the booker what they signed up for.
 *
 * Hidden fields (booker email, additional guests) are still shown — this URL
 * is hard to guess (cuid + token) and was presented to the booker themselves.
 */
export default async function BookingPage({ params, searchParams }: PageProps) {
  const booking = await db.booking.findUnique({
    where: { id: params.bookingId },
    include: { eventType: { select: { title: true, slug: true, questions: { orderBy: { position: 'asc' }, select: { id: true, label: true } } } } },
  });

  if (!booking) notFound();

  const providedToken = (searchParams.t ?? '').trim();
  const tokenKind = providedToken ? verifyBookingToken(booking, providedToken) : null;
  const canManage = tokenKind !== null;

  const vm: BookingViewModel = {
    id: booking.id,
    eventTitle: booking.eventType.title,
    startAt: booking.startAt,
    endAt: booking.endAt,
    status: booking.status,
    bookerName: booking.bookerName,
    bookerEmail: booking.bookerEmail,
    bookerTimezone: booking.bookerTimezone,
    additionalGuests: safeParseArray(booking.additionalGuestsJson).map(String),
    notes: booking.notes,
    meetingUrl: booking.meetingUrl,
    needsSync: booking.needsSync,
    cancelledAt: booking.cancelledAt,
    cancelReason: booking.cancelReason,
    questions: booking.eventType.questions,
    answers: Object.fromEntries(
      Object.entries(safeParseObject(booking.answersJson)).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
    ),
  };

  const range = formatRange(vm.startAt, vm.endAt, vm.bookerTimezone);
  const isCancelled = vm.status === 'cancelled';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-label-l text-on-surface-variant">
          {isCancelled ? 'Booking cancelled' : 'Booking confirmed'}
        </p>
        <h1 className="text-headline-l text-on-background">{vm.eventTitle}</h1>
        {isCancelled && vm.cancelledAt && (
          <p className="text-body-m text-on-surface-variant">
            Cancelled on {DateTime.fromJSDate(vm.cancelledAt).toLocaleString(DateTime.DATETIME_MED)}.
            {vm.cancelReason ? ` Reason: ${vm.cancelReason}` : ''}
          </p>
        )}
        {vm.needsSync && !isCancelled && (
          <p className="rounded-shape-xs bg-tertiary-container px-3 py-2 text-body-s text-on-tertiary-container">
            This booking is awaiting sync to Google Calendar. The owner will follow up.
          </p>
        )}
      </header>

      <Card variant="filled">
        <Card.Header>
          <h2 className="text-title-m text-on-surface">When</h2>
        </Card.Header>
        <Card.Content className="flex flex-col gap-1">
          <p className="text-body-l text-on-surface">{range.line}</p>
          <p className="text-body-s text-on-surface-variant">
            {range.tzLabel} · {range.utc}
          </p>
        </Card.Content>
      </Card>

      {(vm.meetingUrl || vm.bookerEmail) && (
        <Card variant="outlined">
          <Card.Header>
            <h2 className="text-title-m text-on-surface">Details</h2>
          </Card.Header>
          <Card.Content className="flex flex-col gap-2">
            {vm.meetingUrl && !isCancelled && (
              <p className="text-body-m text-on-surface">
                <span className="text-on-surface-variant">Where: </span>
                <a className="text-primary underline" href={vm.meetingUrl} target="_blank" rel="noreferrer">
                  {vm.meetingUrl}
                </a>
              </p>
            )}
            <p className="text-body-m text-on-surface">
              <span className="text-on-surface-variant">Booker: </span>
              {vm.bookerName} &lt;{vm.bookerEmail}&gt;
            </p>
            {vm.additionalGuests.length > 0 && (
              <p className="text-body-m text-on-surface">
                <span className="text-on-surface-variant">Guests: </span>
                {vm.additionalGuests.join(', ')}
              </p>
            )}
            {vm.notes && (
              <p className="whitespace-pre-wrap text-body-m text-on-surface">
                <span className="text-on-surface-variant">Notes: </span>
                {vm.notes}
              </p>
            )}
            {vm.questions.length > 0 && (
              <div className="flex flex-col gap-1">
                {vm.questions.map((q) => {
                  const a = vm.answers[q.id];
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
      )}

      {canManage && !isCancelled && (
        <BookingActions
          bookingId={vm.id}
          token={providedToken}
          tokenKind={tokenKind!}
        />
      )}

      {!canManage && (
        <Card variant="outlined">
          <Card.Content className="flex flex-col gap-3">
            <p className="text-body-s text-on-surface-variant">
              This is a read-only view. Use the management link emailed to you for cancel or reschedule.
            </p>
            <Link href="/" className="text-body-s text-primary underline">
              Back to home
            </Link>
          </Card.Content>
        </Card>
      )}
    </div>
  );
}
