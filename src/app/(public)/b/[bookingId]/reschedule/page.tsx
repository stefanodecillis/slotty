import { notFound, redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { RotateCcw } from 'lucide-react';

import { db } from '@/lib/db';
import { verifyBookingToken } from '@/lib/booking/tokens';

import { ReschedulePicker } from './_components/reschedule-picker';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { bookingId: string };
  searchParams: { t?: string };
}

/**
 * Reschedule page. Token-gated; without a valid reschedule token we 404.
 */
export default async function ReschedulePage({ params, searchParams }: PageProps) {
  const booking = await db.booking.findUnique({
    where: { id: params.bookingId },
    include: {
      eventType: { select: { slug: true, title: true, durationMinutes: true } },
    },
  });
  if (!booking) notFound();

  const token = (searchParams.t ?? '').trim();
  const kind = token ? verifyBookingToken(booking, token) : null;
  if (kind !== 'reschedule') notFound();

  if (booking.status === 'cancelled') {
    redirect(`/b/${booking.id}`);
  }

  const tz = booking.bookerTimezone;
  const originalStart = DateTime.fromJSDate(booking.startAt, { zone: 'utc' }).setZone(tz);
  const originalEnd = DateTime.fromJSDate(booking.endAt, { zone: 'utc' }).setZone(tz);
  const originalLabel = `${originalStart.toLocaleString({ weekday: 'long', month: 'long', day: 'numeric' })} · ${originalStart.toFormat('HH:mm')}–${originalEnd.toFormat('HH:mm')} ${tz.replace(/_/g, ' ')}`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:py-12">
      {/* Top banner */}
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted px-4 py-3">
        <RotateCcw className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-xs font-medium text-foreground">
            Rescheduling: {booking.eventType.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Originally: {originalLabel}
          </p>
        </div>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-foreground">Pick a new time</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The original meeting link (if any) will stay the same.
        </p>
      </div>

      <ReschedulePicker
        bookingId={booking.id}
        token={token}
        slug={booking.eventType.slug}
        durationMinutes={booking.eventType.durationMinutes}
        currentStartUtc={booking.startAt.toISOString()}
        currentBookerTz={booking.bookerTimezone}
      />
    </div>
  );
}
