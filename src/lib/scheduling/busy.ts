import { db } from '@/lib/db';
import { mergeIntervals, type Interval } from './intervals';

/**
 * Fetch all busy intervals owned by `userId` that overlap [from, to).
 *
 * Two sources are unioned:
 *   1. Google-synced events from calendars flagged `isBusySource=true`,
 *      `transparency='opaque'`, `status !== 'cancelled'`.
 *   2. Slotty's own confirmed bookings (`status !== 'cancelled'`). Including
 *      these closes the race window between local insert and the moment the
 *      Google round-trip mirrors the booking back into BusyEvent — without it,
 *      a freshly booked slot remains visible to the next booker for up to one
 *      poll cycle.
 *
 * Both sets are merged so any overlap (e.g. once Google sync catches up and
 * BusyEvent now contains the same booking) collapses harmlessly into one block.
 */
export async function getBusyIntervals(
  userId: string,
  from: Date,
  to: Date,
): Promise<Interval[]> {
  // Single-user MVP: every ConnectedAccount and every EventType belongs to the
  // same user, so filtering by Calendar→ConnectedAccount→user is implicit for
  // BusyEvent. For Booking we filter by EventType.userId to be explicit.
  const [events, bookings] = await Promise.all([
    db.busyEvent.findMany({
      where: {
        startAt: { lt: to },
        endAt: { gt: from },
        status: { not: 'cancelled' },
        transparency: 'opaque',
        calendar: { isBusySource: true },
      },
      select: { startAt: true, endAt: true },
    }),
    db.booking.findMany({
      where: {
        startAt: { lt: to },
        endAt: { gt: from },
        status: { not: 'cancelled' },
        eventType: { userId },
      },
      select: { startAt: true, endAt: true },
    }),
  ]);

  const intervals: Interval[] = [
    ...events.map((e) => ({ start: e.startAt.getTime(), end: e.endAt.getTime() })),
    ...bookings.map((b) => ({ start: b.startAt.getTime(), end: b.endAt.getTime() })),
  ];

  return mergeIntervals(intervals);
}
