import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';
import { Calendar, CalendarOff, CheckCircle2, RefreshCw, StickyNote, User, Video } from 'lucide-react';

import { db } from '@/lib/db';
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

function formatRange(
  start: Date,
  end: Date,
  tz: string,
): { date: string; time: string; tzLabel: string } {
  const tzStart = DateTime.fromJSDate(start, { zone: 'utc' }).setZone(tz);
  const tzEnd = DateTime.fromJSDate(end, { zone: 'utc' }).setZone(tz);
  const date = tzStart.toLocaleString({
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const time = `${tzStart.toFormat('HH:mm')} – ${tzEnd.toFormat('HH:mm')}`;
  return { date, time, tzLabel: tz.replace(/_/g, ' ') };
}

/**
 * Public booking confirmation/management page.
 *
 * Token-gated: ?t=<token> grants manage rights (cancel + reschedule + ICS).
 * Without a token, renders a read-only summary.
 */
export default async function BookingPage({ params, searchParams }: PageProps) {
  const booking = await db.booking.findUnique({
    where: { id: params.bookingId },
    include: {
      eventType: {
        select: {
          title: true,
          slug: true,
          questions: {
            orderBy: { position: 'asc' },
            select: { id: true, label: true },
          },
        },
      },
    },
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
      Object.entries(safeParseObject(booking.answersJson)).map(([k, v]) => [
        k,
        typeof v === 'string' ? v : JSON.stringify(v),
      ]),
    ),
  };

  const range = formatRange(vm.startAt, vm.endAt, vm.bookerTimezone);
  const isCancelled = vm.status === 'cancelled';

  return (
    <div className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 py-12 sm:py-16">
      {/* Status icon + headline */}
      <div className="flex flex-col items-center gap-4 text-center">
        <div
          className={[
            'flex h-16 w-16 items-center justify-center rounded-full',
            isCancelled ? 'bg-card' : 'bg-emerald-100',
          ].join(' ')}
        >
          {isCancelled ? (
            <CalendarOff className="h-8 w-8 text-muted-foreground" aria-hidden />
          ) : (
            <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
          )}
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            {isCancelled ? 'Booking cancelled' : 'Booking confirmed'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{vm.eventTitle}</p>
        </div>
      </div>

      {/* Cancelled note */}
      {isCancelled && vm.cancelledAt && (
        <div className="rounded-lg border border-border bg-muted px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Cancelled on{' '}
            {DateTime.fromJSDate(vm.cancelledAt).toLocaleString(DateTime.DATETIME_MED)}.
            {vm.cancelReason ? ` Reason: ${vm.cancelReason}` : ''}
          </p>
        </div>
      )}

      {/* Needs sync notice */}
      {vm.needsSync && !isCancelled && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted px-4 py-3">
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <p className="text-xs text-muted-foreground">
            This booking is awaiting sync to Google Calendar. The owner will follow up.
          </p>
        </div>
      )}

      {/* When */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/50 p-5">
        <div className="flex items-start gap-3">
          <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-base text-foreground">{range.date}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {range.time} &middot; {range.tzLabel}
            </p>
          </div>
        </div>

        {vm.meetingUrl && !isCancelled && (
          <div className="flex items-start gap-3 border-t border-border/40 pt-3">
            <Video className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <a
              href={vm.meetingUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-sm text-primary underline underline-offset-2 hover:text-primary/80"
            >
              {vm.meetingUrl}
            </a>
          </div>
        )}

        <div className="flex items-start gap-3 border-t border-border/40 pt-3">
          <User className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm text-foreground">{vm.bookerName}</p>
            <p className="text-xs text-muted-foreground">{vm.bookerEmail}</p>
            {vm.additionalGuests.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Also: {vm.additionalGuests.join(', ')}
              </p>
            )}
          </div>
        </div>

        {vm.notes && (
          <div className="flex items-start gap-3 border-t border-border/40 pt-3">
            <StickyNote className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{vm.notes}</p>
          </div>
        )}

        {vm.questions.length > 0 && vm.questions.some((q) => vm.answers[q.id]) && (
          <div className="flex flex-col gap-2 border-t border-border/40 pt-3">
            {vm.questions.map((q) => {
              const a = vm.answers[q.id];
              if (!a) return null;
              return (
                <div key={q.id}>
                  <p className="text-xs text-muted-foreground">{q.label}</p>
                  <p className="text-sm text-foreground">{a}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      {canManage && !isCancelled && (
        <BookingActions
          bookingId={vm.id}
          token={providedToken}
          tokenKind={tokenKind!}
        />
      )}

      {!canManage && (
        <p className="text-center text-xs text-muted-foreground">
          Use the management link emailed to you to cancel or reschedule.{' '}
          <Link href="/" className="text-primary underline underline-offset-2">
            Back to home
          </Link>
        </p>
      )}

      {isCancelled && (
        <div className="text-center">
          <Link href="/" className="text-xs text-primary underline underline-offset-2">
            Back to home
          </Link>
        </div>
      )}
    </div>
  );
}
