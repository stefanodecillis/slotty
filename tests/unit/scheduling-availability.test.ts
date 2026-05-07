import { describe, it, expect } from 'bun:test';
import { DateTime } from 'luxon';

import {
  computeDailyAvailability,
  computeAvailabilityWindow,
  indexDateOverrides,
  type ScheduleWithRules,
} from '@/lib/scheduling/availability';
import { totalDuration } from '@/lib/scheduling/intervals';

function makeSchedule(zone: string, rules: { weekday: number; startMinute: number; endMinute: number }[]): ScheduleWithRules {
  return {
    id: 'sched-1',
    userId: 'u1',
    name: 'Test',
    isDefault: true,
    timezone: zone,
    createdAt: new Date(),
    updatedAt: new Date(),
    rules: rules.map((r, idx) => ({
      id: `rule-${idx}`,
      scheduleId: 'sched-1',
      ...r,
    })),
  };
}

const MON_FRI_9_18 = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 18 * 60,
}));

describe('computeDailyAvailability', () => {
  it('Mon-Fri 09-18 produces 9 hours on a Wednesday in UTC', () => {
    const sched = makeSchedule('UTC', MON_FRI_9_18);
    const day = DateTime.fromISO('2026-05-06', { zone: 'UTC' }); // Wednesday
    const intervals = computeDailyAvailability(sched, new Map(), day, 'UTC');
    expect(intervals.length).toBe(1);
    expect(totalDuration(intervals)).toBe(9 * 60 * 60 * 1000);
  });

  it('returns 0 intervals on a Saturday with no rule', () => {
    const sched = makeSchedule('UTC', MON_FRI_9_18);
    const day = DateTime.fromISO('2026-05-09', { zone: 'UTC' }); // Saturday
    const intervals = computeDailyAvailability(sched, new Map(), day, 'UTC');
    expect(intervals).toEqual([]);
  });

  it('respects a blocked DateOverride', () => {
    const sched = makeSchedule('UTC', MON_FRI_9_18);
    const day = DateTime.fromISO('2026-05-06', { zone: 'UTC' });

    const overrides = new Map();
    overrides.set('2026-05-06', {
      id: 'o1',
      scheduleId: 'sched-1',
      date: new Date('2026-05-06T00:00:00Z'),
      isBlocked: true,
      startMinute: null,
      endMinute: null,
      label: null,
      source: 'manual',
      createdAt: new Date(),
    });

    const intervals = computeDailyAvailability(sched, overrides, day, 'UTC');
    expect(intervals).toEqual([]);
  });

  it('honours a custom-hours DateOverride', () => {
    const sched = makeSchedule('UTC', MON_FRI_9_18);
    const day = DateTime.fromISO('2026-05-06', { zone: 'UTC' });

    const overrides = new Map();
    overrides.set('2026-05-06', {
      id: 'o1',
      scheduleId: 'sched-1',
      date: new Date('2026-05-06T00:00:00Z'),
      isBlocked: false,
      startMinute: 13 * 60,
      endMinute: 15 * 60,
      label: null,
      source: 'manual',
      createdAt: new Date(),
    });

    const intervals = computeDailyAvailability(sched, overrides, day, 'UTC');
    expect(intervals.length).toBe(1);
    expect(totalDuration(intervals)).toBe(2 * 60 * 60 * 1000);
  });

  it('emits multiple intervals for split shifts (multiple rules same weekday)', () => {
    const sched = makeSchedule('UTC', [
      { weekday: 3, startMinute: 9 * 60, endMinute: 12 * 60 },
      { weekday: 3, startMinute: 14 * 60, endMinute: 18 * 60 },
    ]);
    const day = DateTime.fromISO('2026-05-06', { zone: 'UTC' }); // Wednesday
    const intervals = computeDailyAvailability(sched, new Map(), day, 'UTC');
    expect(intervals.length).toBe(2);
    expect(totalDuration(intervals)).toBe(7 * 60 * 60 * 1000);
  });
});

describe('computeAvailabilityWindow', () => {
  it('tiles 7 days into 5 weekday intervals', () => {
    const sched = makeSchedule('UTC', MON_FRI_9_18);
    const from = DateTime.fromISO('2026-05-04T00:00:00', { zone: 'UTC' }); // Monday
    const to = DateTime.fromISO('2026-05-10T23:59:59', { zone: 'UTC' });
    const fromMs = from.toMillis();
    const toMs = to.toMillis();
    const intervals = computeAvailabilityWindow(sched, [], from, to, 'UTC', fromMs, toMs);
    expect(intervals.length).toBe(5);
    expect(totalDuration(intervals)).toBe(5 * 9 * 60 * 60 * 1000);
  });

  it('clips intervals to the [windowStart, windowEnd] bounds', () => {
    const sched = makeSchedule('UTC', MON_FRI_9_18);
    const from = DateTime.fromISO('2026-05-06T00:00:00', { zone: 'UTC' }); // Wed
    const to = DateTime.fromISO('2026-05-06T23:59:59', { zone: 'UTC' });
    // Tighten window to 10:00-15:00.
    const fromMs = DateTime.fromISO('2026-05-06T10:00:00Z').toMillis();
    const toMs = DateTime.fromISO('2026-05-06T15:00:00Z').toMillis();
    const intervals = computeAvailabilityWindow(sched, [], from, to, 'UTC', fromMs, toMs);
    expect(totalDuration(intervals)).toBe(5 * 60 * 60 * 1000);
    expect(intervals[0]?.start).toBe(fromMs);
    expect(intervals[0]?.end).toBe(toMs);
  });
});

describe('indexDateOverrides', () => {
  it('keys overrides by yyyy-LL-dd in the schedule tz', () => {
    const o = {
      id: 'o1',
      scheduleId: 'sched-1',
      date: new Date('2026-12-25T00:00:00Z'),
      isBlocked: true,
      startMinute: null,
      endMinute: null,
      label: 'Christmas',
      source: 'manual',
      createdAt: new Date(),
    };
    const map = indexDateOverrides([o], 'America/New_York');
    expect(map.has('2026-12-25')).toBe(true);
  });
});
