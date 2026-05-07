import { notFound, redirect } from 'next/navigation';

import { db } from '@/lib/db';
import { Card } from '@/components/ui/Card';
import { verifyBookingToken } from '@/lib/booking/tokens';

import { ReschedulePicker } from './_components/reschedule-picker';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { bookingId: string };
  searchParams: { t?: string };
}

/**
 * Reschedule page. Token-gated; without a valid reschedule token we 404 to
 * avoid leaking the booking's existence.
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-label-l text-on-surface-variant">Reschedule</p>
        <h1 className="text-headline-l text-on-background">{booking.eventType.title}</h1>
        <p className="text-body-m text-on-surface-variant">
          Pick a new time. The original Google Meet link (if any) will stay the same.
        </p>
      </header>

      <Card variant="filled">
        <Card.Header>
          <h2 className="text-title-m text-on-surface">Current time</h2>
        </Card.Header>
        <Card.Content>
          <p className="text-body-m text-on-surface">
            {booking.startAt.toISOString()} – {booking.endAt.toISOString()}
          </p>
          <p className="text-body-s text-on-surface-variant">
            Booker timezone: {booking.bookerTimezone}
          </p>
        </Card.Content>
      </Card>

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
