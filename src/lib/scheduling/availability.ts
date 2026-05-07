import { DateTime } from 'luxon';
import type { Schedule, ScheduleRule, DateOverride } from '@prisma/client';

import { eachDay, weekdayInZone, wallTimeToUtc } from './dates';
import { mergeIntervals, type Interval } from './intervals';

export interface ScheduleWithRules extends Schedule {
  rules: ScheduleRule[];
}

/**
 * Internal: build a stable lookup key for a calendar date in a given zone.
 * Matches how DateOverride rows are stored (midnight UTC of the date) so we
 * can index by the date's ISO string in the schedule's tz.
 */
function dayKey(dt: DateTime, zone: string): string {
  return dt.setZone(zone).toFormat('yyyy-LL-dd');
}

/**
 * Map DateOverride rows by their `yyyy-LL-dd` label in the schedule's tz.
 *
 * Each row's `date` is stored as midnight UTC of the calendar date — but the
 * date label we want is the wall-clock date in the schedule's tz. We read
 * those numbers in UTC and re-attach them to the schedule zone (without time
 * shift) so e.g. a row with date 2026-03-29T00:00:00Z is keyed as 2026-03-29
 * regardless of the schedule's tz.
 */
export function indexDateOverrides(
  overrides: DateOverride[],
  zone: string,
): Map<string, DateOverride> {
  const map = new Map<string, DateOverride>();
  for (const o of overrides) {
    // Read the stored UTC date components and project them into `zone`
    // without shifting (the date is meant to represent a calendar day).
    const utc = DateTime.fromJSDate(o.date, { zone: 'utc' });
    const local = DateTime.fromObject(
      { year: utc.year, month: utc.month, day: utc.day },
      { zone },
    );
    map.set(local.toFormat('yyyy-LL-dd'), o);
  }
  return map;
}

/**
 * Compute the availability intervals for a single calendar date, expressed in
 * UTC milliseconds.
 *
 * Resolution order:
 *   1. If a DateOverride exists for the date and `isBlocked` → no availability.
 *   2. If a DateOverride exists with custom hours → use exactly those hours.
 *   3. Else → use the matching ScheduleRule rows for that weekday.
 *
 * Note: a single calendar date can have multiple ScheduleRule rows (split
 * shifts, e.g. 09-12 + 14-18). We emit one interval per rule, then merge.
 */
export function computeDailyAvailability(
  schedule: ScheduleWithRules,
  dateOverridesByDay: Map<string, DateOverride>,
  day: DateTime,
  zone: string,
): Interval[] {
  const key = dayKey(day, zone);
  const override = dateOverridesByDay.get(key);

  if (override?.isBlocked) {
    return [];
  }

  const dayIntervals: Interval[] = [];

  if (override && override.startMinute != null && override.endMinute != null) {
    const start = wallTimeToUtc(day, override.startMinute, zone).toMillis();
    const end = wallTimeToUtc(day, override.endMinute, zone).toMillis();
    if (end > start) dayIntervals.push({ start, end });
    return dayIntervals;
  }

  const weekday = weekdayInZone(day, zone);
  const rules = schedule.rules.filter((r) => r.weekday === weekday);
  if (rules.length === 0) return [];

  for (const rule of rules) {
    const start = wallTimeToUtc(day, rule.startMinute, zone).toMillis();
    const end = wallTimeToUtc(day, rule.endMinute, zone).toMillis();
    if (end > start) dayIntervals.push({ start, end });
  }

  return mergeIntervals(dayIntervals);
}

/**
 * Compute availability across the full window. Result is one merged array of
 * UTC intervals across every day in [from, to] (booker-tz wise).
 *
 * `windowFromUtcMs` / `windowToUtcMs` clip the result so daily intervals that
 * extend beyond the booking window aren't returned.
 */
export function computeAvailabilityWindow(
  schedule: ScheduleWithRules,
  overrides: DateOverride[],
  from: DateTime,
  to: DateTime,
  zone: string,
  windowFromUtcMs: number,
  windowToUtcMs: number,
): Interval[] {
  const overrideMap = indexDateOverrides(overrides, schedule.timezone);
  const days = eachDay(from, to, schedule.timezone);

  const all: Interval[] = [];
  for (const day of days) {
    const daily = computeDailyAvailability(schedule, overrideMap, day, schedule.timezone);
    for (const interval of daily) {
      const start = Math.max(interval.start, windowFromUtcMs);
      const end = Math.min(interval.end, windowToUtcMs);
      if (end > start) all.push({ start, end });
    }
    void zone;
  }

  return mergeIntervals(all);
}
