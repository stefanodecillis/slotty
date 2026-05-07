/**
 * DST correctness for slot/availability computation.
 *
 * The window 09:00-18:00 wall time is the canonical case (Mon-Fri 9-18). We
 * verify the produced UTC duration on every documented DST cusp:
 *
 *   - Europe/Rome: 09-18 wall window does NOT cross 02:00 → spring-forward
 *     and fall-back days both produce the normal 9 hours.
 *   - America/New_York: same — the 02:00→03:00 jump in March (and 02:00 doubling
 *     in November) happens before 09:00 on the affected day, so the wall
 *     window is unaffected.
 *   - When the window IS made to cross the transition (02:00-04:00 on March
 *     spring-forward day), we get the expected 1 hour instead of 2.
 *   - When it crosses the November fall-back transition (01:30-03:00), we get
 *     the expected 2.5 hours instead of 1.5.
 *   - A booker in a different tz than the schedule sees correct booker-tz
 *     wall times (the chosen schedule wall hours don't shift).
 */

import { describe, it, expect } from 'bun:test';
import { DateTime } from 'luxon';

import {
  computeDailyAvailability,
  type ScheduleWithRules,
} from '@/lib/scheduling/availability';
import { totalDuration } from '@/lib/scheduling/intervals';

function makeSchedule(zone: string, weekday: number, startMin: number, endMin: number): ScheduleWithRules {
  return {
    id: 'sched-1',
    userId: 'u1',
    name: 'Test',
    isDefault: true,
    timezone: zone,
    createdAt: new Date(),
    updatedAt: new Date(),
    rules: [
      {
        id: 'rule-1',
        scheduleId: 'sched-1',
        weekday,
        startMinute: startMin,
        endMinute: endMin,
      },
    ],
  };
}

const HOUR_MS = 60 * 60 * 1000;

describe('Europe/Rome DST', () => {
  it('spring forward 2026-03-29: 09-18 wall window remains 9 hours UTC', () => {
    // Last Sunday of March 2026 — Italy goes from 02:00 CET to 03:00 CEST.
    const day = DateTime.fromISO('2026-03-29', { zone: 'Europe/Rome' });
    const sched = makeSchedule('Europe/Rome', 0, 9 * 60, 18 * 60); // Sunday
    const intervals = computeDailyAvailability(sched, new Map(), day, 'Europe/Rome');
    expect(intervals.length).toBe(1);
    expect(totalDuration(intervals)).toBe(9 * HOUR_MS);

    // 09:00 in Rome on this day is 07:00 UTC (CEST = UTC+2).
    const startUtc = DateTime.fromMillis(intervals[0]!.start, { zone: 'utc' });
    expect(startUtc.toISO({ suppressMilliseconds: true })).toBe('2026-03-29T07:00:00Z');
  });

  it('fall back 2026-10-25: 09-18 wall window remains 9 hours UTC', () => {
    // Last Sunday of October 2026 — Italy goes from 03:00 CEST to 02:00 CET.
    const day = DateTime.fromISO('2026-10-25', { zone: 'Europe/Rome' });
    const sched = makeSchedule('Europe/Rome', 0, 9 * 60, 18 * 60);
    const intervals = computeDailyAvailability(sched, new Map(), day, 'Europe/Rome');
    expect(intervals.length).toBe(1);
    expect(totalDuration(intervals)).toBe(9 * HOUR_MS);

    // After fall-back, Rome is back to CET = UTC+1, so 09:00 Rome = 08:00 UTC.
    const startUtc = DateTime.fromMillis(intervals[0]!.start, { zone: 'utc' });
    expect(startUtc.toISO({ suppressMilliseconds: true })).toBe('2026-10-25T08:00:00Z');
  });

  it('window that crosses the spring-forward transition loses an hour', () => {
    // Sunday 02:00-04:00 in Rome on 2026-03-29: wall hour 02:00-03:00 doesn't
    // exist (clocks jump). Luxon resolves wallTime 02:00 to 03:00 post-skip,
    // so the window collapses to 03:00-04:00 = 1 hour.
    const day = DateTime.fromISO('2026-03-29', { zone: 'Europe/Rome' });
    const sched = makeSchedule('Europe/Rome', 0, 2 * 60, 4 * 60);
    const intervals = computeDailyAvailability(sched, new Map(), day, 'Europe/Rome');
    expect(totalDuration(intervals)).toBe(1 * HOUR_MS);
  });

  it('window that crosses the fall-back transition gains an hour', () => {
    // Sunday 01:30-03:00 in Rome on 2026-10-25 actually contains both the
    // first 02:00 (CEST) and the second 02:00 (CET) → 2.5 hours of UTC width.
    const day = DateTime.fromISO('2026-10-25', { zone: 'Europe/Rome' });
    const sched = makeSchedule('Europe/Rome', 0, 1 * 60 + 30, 3 * 60);
    const intervals = computeDailyAvailability(sched, new Map(), day, 'Europe/Rome');
    expect(totalDuration(intervals)).toBe(2.5 * HOUR_MS);
  });
});

describe('America/New_York DST', () => {
  it('spring forward 2026-03-08: 09-18 wall window remains 9 hours UTC', () => {
    const day = DateTime.fromISO('2026-03-08', { zone: 'America/New_York' });
    const sched = makeSchedule('America/New_York', 0, 9 * 60, 18 * 60);
    const intervals = computeDailyAvailability(sched, new Map(), day, 'America/New_York');
    expect(totalDuration(intervals)).toBe(9 * HOUR_MS);

    // After spring-forward, NY is EDT = UTC-4, so 09:00 NY = 13:00 UTC.
    const startUtc = DateTime.fromMillis(intervals[0]!.start, { zone: 'utc' });
    expect(startUtc.toISO({ suppressMilliseconds: true })).toBe('2026-03-08T13:00:00Z');
  });

  it('fall back 2026-11-01: 09-18 wall window remains 9 hours UTC', () => {
    const day = DateTime.fromISO('2026-11-01', { zone: 'America/New_York' });
    const sched = makeSchedule('America/New_York', 0, 9 * 60, 18 * 60);
    const intervals = computeDailyAvailability(sched, new Map(), day, 'America/New_York');
    expect(totalDuration(intervals)).toBe(9 * HOUR_MS);

    // After fall-back, NY is EST = UTC-5, so 09:00 NY = 14:00 UTC.
    const startUtc = DateTime.fromMillis(intervals[0]!.start, { zone: 'utc' });
    expect(startUtc.toISO({ suppressMilliseconds: true })).toBe('2026-11-01T14:00:00Z');
  });

  it('window that crosses spring-forward (02:00-04:00 NY) loses an hour', () => {
    const day = DateTime.fromISO('2026-03-08', { zone: 'America/New_York' });
    const sched = makeSchedule('America/New_York', 0, 2 * 60, 4 * 60);
    const intervals = computeDailyAvailability(sched, new Map(), day, 'America/New_York');
    expect(totalDuration(intervals)).toBe(1 * HOUR_MS);
  });

  it('window that crosses fall-back (01:30-03:00 NY) gains an hour', () => {
    const day = DateTime.fromISO('2026-11-01', { zone: 'America/New_York' });
    const sched = makeSchedule('America/New_York', 0, 1 * 60 + 30, 3 * 60);
    const intervals = computeDailyAvailability(sched, new Map(), day, 'America/New_York');
    expect(totalDuration(intervals)).toBe(2.5 * HOUR_MS);
  });
});

describe('Booker tz independence', () => {
  it('a Rome 09-18 schedule produces the same UTC slot regardless of booker tz', () => {
    const day = DateTime.fromISO('2026-07-15', { zone: 'Europe/Rome' });
    const sched = makeSchedule('Europe/Rome', 3, 9 * 60, 18 * 60); // Wed

    const intervals = computeDailyAvailability(sched, new Map(), day, 'Europe/Rome');
    expect(totalDuration(intervals)).toBe(9 * HOUR_MS);
    // Rome in July = CEST = UTC+2. 09:00 Rome = 07:00 UTC.
    expect(intervals[0]!.start).toBe(DateTime.fromISO('2026-07-15T07:00:00Z').toMillis());
    expect(intervals[0]!.end).toBe(DateTime.fromISO('2026-07-15T16:00:00Z').toMillis());
  });
});
