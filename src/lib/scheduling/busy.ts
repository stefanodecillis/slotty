import { db } from '@/lib/db';
import { mergeIntervals, type Interval } from './intervals';

/**
 * Fetch all busy intervals owned by `userId` that overlap [from, to).
 *
 * "Busy" means: an event from a calendar marked `isBusySource=true`, with
 * `transparency='opaque'` and `status !== 'cancelled'`. The events come from
 * Phase 3's sync engine (BusyEvent table) — we never hit Google here.
 *
 * Phase 7 will add `getBookedIntervals` and union with this. For now, only
 * external busy intervals are subtracted from availability.
 */
export async function getBusyIntervals(
  userId: string,
  from: Date,
  to: Date,
): Promise<Interval[]> {
  void userId; // single-user app; ConnectedAccount → User chain isn't modelled directly.

  // Note: in this single-user MVP every ConnectedAccount belongs to the one
  // user, so filtering by `Calendar.connectedAccount` user is implicit.
  // We still scope to `isBusySource=true` calendars and exclude cancelled
  // events. Half-open overlap: event.end > windowStart AND event.start < windowEnd.
  const events = await db.busyEvent.findMany({
    where: {
      startAt: { lt: to },
      endAt: { gt: from },
      status: { not: 'cancelled' },
      transparency: 'opaque',
      calendar: {
        isBusySource: true,
      },
    },
    select: {
      startAt: true,
      endAt: true,
    },
  });

  const intervals: Interval[] = events.map((e) => ({
    start: e.startAt.getTime(),
    end: e.endAt.getTime(),
  }));

  return mergeIntervals(intervals);
}
