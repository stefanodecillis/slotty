import { DateTime } from 'luxon';

/**
 * Yield one Luxon DateTime per calendar date in the given zone, at start-of-day,
 * walking from `from` to `to` (both inclusive of their date components).
 *
 * The bounds are interpreted in the supplied zone — e.g. for Europe/Rome a `from`
 * of 2026-03-29T01:00:00Z covers the date 2026-03-29 in Rome.
 */
export function eachDay(from: DateTime, to: DateTime, zone: string): DateTime[] {
  const start = from.setZone(zone).startOf('day');
  const end = to.setZone(zone).startOf('day');

  const days: DateTime[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

/**
 * Weekday number for the calendar date represented by `dt`, viewed in `zone`,
 * using the convention 0 = Sunday … 6 = Saturday (matching `ScheduleRule.weekday`).
 *
 * Luxon's `.weekday` is ISO (1=Mon..7=Sun); we remap it.
 */
export function weekdayInZone(dt: DateTime, zone: string): number {
  const local = dt.setZone(zone);
  // Luxon: 1=Monday, 7=Sunday. Convert to 0=Sunday, 1=Monday, ... 6=Saturday.
  return local.weekday === 7 ? 0 : local.weekday;
}

/**
 * Convert a (calendar date, minute-of-day) pair in `zone` into a UTC DateTime.
 *
 * `minuteOfDay` is an integer in [0, 1440]. 1440 represents the *exclusive*
 * end of the day, which Luxon naturally handles by rolling into the next day's
 * 00:00 — that's exactly what we want for end-of-day boundaries.
 *
 * On a DST forward transition, wall-clock times in the missing hour (e.g.
 * 02:30 in Europe/Rome on 2026-03-29) don't exist. Luxon resolves these to
 * the *next valid instant* (post-skip). On a DST backward transition,
 * ambiguous wall-clock times are resolved to the first occurrence (pre-fall),
 * matching real-world calendar semantics.
 */
export function wallTimeToUtc(
  date: DateTime,
  minuteOfDay: number,
  zone: string,
): DateTime {
  const base = date.setZone(zone).startOf('day');
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;

  // Note: passing hour=24 wraps to next-day 00:00 cleanly.
  return base
    .set({ hour, minute, second: 0, millisecond: 0 })
    .toUTC();
}

/**
 * Format a UTC ms-timestamp as YYYY-MM-DD in the given zone — used to bucket
 * slots by booker-facing calendar date.
 */
export function isoDateInZone(ms: number, zone: string): string {
  return DateTime.fromMillis(ms, { zone: 'utc' }).setZone(zone).toFormat('yyyy-LL-dd');
}

/**
 * Format a UTC ms-timestamp as ISO week label `YYYY-Www` in the given zone.
 * Used for max-per-week grouping. ISO weeks start on Monday by convention,
 * which is what the bookingWindowDays/maxPerWeek limit cares about.
 */
export function isoWeekInZone(ms: number, zone: string): string {
  const dt = DateTime.fromMillis(ms, { zone: 'utc' }).setZone(zone);
  return `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}`;
}

/**
 * Format a UTC ms-timestamp in the booker's tz like `09:00` (24h). Used when
 * shipping slots back to the client so the UI doesn't need to recompute it.
 */
export function timeLabelInZone(ms: number, zone: string): string {
  return DateTime.fromMillis(ms, { zone: 'utc' })
    .setZone(zone)
    .toFormat('HH:mm');
}
