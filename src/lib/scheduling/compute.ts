/**
 * Slot computation algorithm — the core of public booking.
 *
 * Produces, for an event type and a booker-tz window, the list of bookable
 * start instants. See `docs/architecture` (or PHASE-6.md) for the high-level
 * walk-through; the steps below mirror the spec exactly.
 *
 * Key invariant: every interval inside this module is **UTC milliseconds**.
 * The only places we touch wall-clock time are (a) `wallTimeToUtc` when the
 * schedule's hours are projected onto a calendar date and (b) the labelling
 * helpers we use when shipping the result back to the client.
 */

import { DateTime } from 'luxon';
import type { EventType, User } from '@prisma/client';

import { db } from '@/lib/db';
import {
  computeAvailabilityWindow,
  type ScheduleWithRules,
} from './availability';
import { getBusyIntervals } from './busy';
import {
  isoDateInZone,
  isoWeekInZone,
  timeLabelInZone,
  wallTimeToUtc,
} from './dates';
import {
  makeInterval,
  mergeIntervals,
  subtract,
  type Interval,
} from './intervals';
import {
  getSlots as cacheGet,
  setSlots as cacheSet,
  makeKey,
} from './cache';
import type { SlotResult, SlotEntry, SlotDay } from './compute-types';

export type { SlotResult, SlotEntry, SlotDay };

export interface ComputeSlotsArgs {
  eventType: EventType;
  user: User;
  from: Date;
  to: Date;
  bookerTz: string;
  /** Override "now" for tests. Defaults to `new Date()`. */
  now?: Date;
  /**
   * Optional injected counts of *existing bookings* for the maxPerDay /
   * maxPerWeek caps. Phase 7 will populate this from the Booking table; for
   * Phase 6 callers can omit it (treated as zero).
   */
  bookingsCount?: {
    byDay: Map<string, number>;
    byWeek: Map<string, number>;
  };
  /** Skip the cache (used by tests). */
  noCache?: boolean;
}

const MIN_NOTICE_FLOOR_MIN = 0;
const MAX_WINDOW_DAYS = 90;

async function loadSchedule(
  eventType: EventType,
  user: User,
): Promise<ScheduleWithRules | null> {
  if (eventType.scheduleId) {
    return db.schedule.findUnique({
      where: { id: eventType.scheduleId },
      include: { rules: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] } },
    });
  }
  return db.schedule.findFirst({
    where: { userId: user.id, isDefault: true },
    include: { rules: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] } },
  });
}

/**
 * Step 5 (buffer extension). Candidate starts are the availability windows
 * shrunk so that the protected span `[S - bufferBefore, S + duration + bufferAfter)`
 * fits, then with each busy block "padded" to forbid candidate starts whose
 * protected span overlaps the busy block.
 *
 * Conventions:
 *   - All intervals here are half-open `[start, end)`.
 *   - Availability `[a, b)`. Slot at S of total duration `d` is valid iff
 *       a + bb <= S <= b - tail, where tail = d + ba.
 *     The set of valid S is `[a + bb, b - tail]` *inclusive on the right*.
 *     We store candidates as half-open by extending the right edge by 1 ms.
 *   - Busy `[bs, be)` blocks any candidate start S whose protected span
 *     `[S - bb, S + tail)` overlaps `[bs, be)`. That overlap happens iff
 *       S - bb < be  AND  S + tail > bs
 *     i.e. `S ∈ (bs - tail, be + bb)`. As half-open `[start, end)` we can
 *     write `[bs - tail + 1, be + bb)`.
 *
 * The +1 ms epsilon is below the resolution of any user-facing slot grid
 * (slotIntervalMin is in minutes), so it never affects emitted slot starts.
 */
function shrinkAvailabilityForSlotStart(
  availability: Interval[],
  durationMs: number,
  bufferBeforeMs: number,
  bufferAfterMs: number,
): Interval[] {
  const out: Interval[] = [];
  const tailMs = durationMs + bufferAfterMs;
  for (const a of availability) {
    const start = a.start + bufferBeforeMs;
    const end = a.end - tailMs + 1;
    if (end > start) out.push({ start, end });
  }
  return out;
}

function busyExclusionsForCandidateStart(
  busy: Interval[],
  durationMs: number,
  bufferBeforeMs: number,
  bufferAfterMs: number,
): Interval[] {
  const tailMs = durationMs + bufferAfterMs;
  const expanded: Interval[] = [];
  for (const b of busy) {
    const start = b.start - tailMs + 1;
    const end = b.end + bufferBeforeMs;
    const i = makeInterval(start, end);
    if (i) expanded.push(i);
  }
  return mergeIntervals(expanded);
}

/**
 * Generate slot starts within each candidate interval, snapped to the schedule
 * tz's `slotIntervalMin` boundaries aligned at top-of-hour.
 *
 * The alignment grid is computed *in the schedule timezone* — that's what
 * humans expect ("slots at :00, :15, :30, :45"). For booker-tz alignment we
 * could re-snap, but the spec calls for schedule-tz alignment for predictability.
 */
function emitSlotStarts(
  candidates: Interval[],
  scheduleTz: string,
  slotIntervalMin: number,
): number[] {
  const slots: number[] = [];
  const stepMs = slotIntervalMin * 60 * 1000;

  for (const c of candidates) {
    // Anchor on the most recent top-of-hour AT OR BEFORE c.start in scheduleTz,
    // then walk forward by stepMs until we leave the candidate interval.
    // Candidates encode "valid starts" half-open: [c.start, c.end) where c.end
    // is the last *inclusive* valid start (we built them that way in
    // `shrinkAvailabilityForSlotStart`), so we allow cursor === c.end.
    const startDt = DateTime.fromMillis(c.start, { zone: 'utc' }).setZone(scheduleTz);
    const anchorWall = startDt.set({ minute: 0, second: 0, millisecond: 0 });
    let cursorMs = anchorWall.toUTC().toMillis();
    while (cursorMs < c.start) cursorMs += stepMs;
    while (cursorMs < c.end) {
      slots.push(cursorMs);
      cursorMs += stepMs;
    }
  }

  // Ensure ascending and dedup.
  slots.sort((a, b) => a - b);
  const out: number[] = [];
  let prev = -1;
  for (const s of slots) {
    if (s !== prev) {
      out.push(s);
      prev = s;
    }
  }
  return out;
}

/**
 * Apply maxPerDay / maxPerWeek caps. Slots on a day that already has
 * `maxPerDay` confirmed bookings are dropped wholesale (we don't try to
 * include partial sub-counts because every new booking would land on the
 * same day; the simpler rule is: full → no new offerings).
 */
function applyFrequencyLimits(
  slots: number[],
  eventType: EventType,
  scheduleTz: string,
  bookingsCount: ComputeSlotsArgs['bookingsCount'],
): number[] {
  const { maxPerDay, maxPerWeek } = eventType;
  if (maxPerDay == null && maxPerWeek == null) return slots;
  const byDay = bookingsCount?.byDay ?? new Map<string, number>();
  const byWeek = bookingsCount?.byWeek ?? new Map<string, number>();

  return slots.filter((ms) => {
    const dayKey = isoDateInZone(ms, scheduleTz);
    const weekKey = isoWeekInZone(ms, scheduleTz);
    if (maxPerDay != null && (byDay.get(dayKey) ?? 0) >= maxPerDay) return false;
    if (maxPerWeek != null && (byWeek.get(weekKey) ?? 0) >= maxPerWeek) return false;
    return true;
  });
}

function groupByDay(
  slots: number[],
  bookerTz: string,
  durationMs: number,
): SlotDay[] {
  const map = new Map<string, SlotEntry[]>();
  for (const ms of slots) {
    const date = isoDateInZone(ms, bookerTz);
    const entry: SlotEntry = {
      startUtc: new Date(ms).toISOString(),
      endUtc: new Date(ms + durationMs).toISOString(),
      startInBookerTz: timeLabelInZone(ms, bookerTz),
    };
    const arr = map.get(date);
    if (arr) arr.push(entry);
    else map.set(date, [entry]);
  }
  const days: SlotDay[] = [];
  const keys = Array.from(map.keys()).sort();
  for (const date of keys) {
    days.push({ date, slots: map.get(date)! });
  }
  return days;
}

export async function computeSlots(args: ComputeSlotsArgs): Promise<SlotResult> {
  const { eventType, user, bookerTz } = args;
  const now = args.now ?? new Date();

  const requestedFromMs = args.from.getTime();
  const requestedToMs = args.to.getTime();

  // Effective window: clip [from,to] to [now+minNotice, now+bookingWindow].
  const noticeMs = Math.max(MIN_NOTICE_FLOOR_MIN, eventType.minNoticeMin) * 60 * 1000;
  const windowEndMs = now.getTime() + eventType.bookingWindowDays * 24 * 60 * 60 * 1000;
  const effectiveFromMs = Math.max(requestedFromMs, now.getTime() + noticeMs);
  const effectiveToMs = Math.min(requestedToMs, windowEndMs);

  const emptyResult: SlotResult = {
    days: [],
    bookerTz,
    eventTypeId: eventType.id,
  };

  if (effectiveToMs <= effectiveFromMs) return emptyResult;

  const schedule = await loadSchedule(eventType, user);
  if (!schedule) return emptyResult;

  // Cache lookup. We fold the latest BusyEvent.updatedAt into the key so a
  // sync that mutates busy data implicitly invalidates without an explicit hook.
  const busyCursor = await db.busyEvent.aggregate({
    _max: { updatedAt: true },
  });
  const busyMaxUpdatedAtMs = busyCursor._max.updatedAt
    ? busyCursor._max.updatedAt.getTime()
    : 0;

  const cacheKey = makeKey({
    eventTypeId: eventType.id,
    fromMs: effectiveFromMs,
    toMs: effectiveToMs,
    tz: bookerTz,
    busyMaxUpdatedAtMs,
  });

  if (!args.noCache) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }

  // 1) Per-day availability over [effectiveFrom, effectiveTo] in schedule tz.
  const fromDt = DateTime.fromMillis(effectiveFromMs, { zone: 'utc' });
  const toDt = DateTime.fromMillis(effectiveToMs, { zone: 'utc' });

  const overrides = await db.dateOverride.findMany({
    where: {
      scheduleId: schedule.id,
    },
  });

  const availability = computeAvailabilityWindow(
    schedule,
    overrides,
    fromDt,
    toDt,
    schedule.timezone,
    effectiveFromMs,
    effectiveToMs,
  );

  if (availability.length === 0) {
    cacheSet(cacheKey, emptyResult);
    return emptyResult;
  }

  // 2) Busy intervals (Google + future Phase 7 bookings).
  const busy = await getBusyIntervals(
    user.id,
    new Date(effectiveFromMs),
    new Date(effectiveToMs),
  );

  // 3) Buffer-aware candidate starts.
  const durationMs = eventType.durationMinutes * 60 * 1000;
  const bufferBeforeMs = eventType.bufferBeforeMin * 60 * 1000;
  const bufferAfterMs = eventType.bufferAfterMin * 60 * 1000;

  const candidateBase = shrinkAvailabilityForSlotStart(
    availability,
    durationMs,
    bufferBeforeMs,
    bufferAfterMs,
  );

  const exclusions = busyExclusionsForCandidateStart(
    busy,
    durationMs,
    bufferBeforeMs,
    bufferAfterMs,
  );

  const candidates = subtract(candidateBase, exclusions);

  // 4) Snap to slot-interval grid in schedule tz.
  let slots = emitSlotStarts(candidates, schedule.timezone, eventType.slotIntervalMin);

  // 5) Drop slots before now+minNotice (defense; effectiveFrom should already cover it).
  const noticeCutoff = now.getTime() + noticeMs;
  slots = slots.filter((s) => s >= noticeCutoff);

  // 6) Frequency caps.
  slots = applyFrequencyLimits(slots, eventType, schedule.timezone, args.bookingsCount);

  const result: SlotResult = {
    days: groupByDay(slots, bookerTz, durationMs),
    bookerTz,
    eventTypeId: eventType.id,
  };

  if (!args.noCache) cacheSet(cacheKey, result);
  return result;
}

export const _internal = {
  shrinkAvailabilityForSlotStart,
  busyExclusionsForCandidateStart,
  emitSlotStarts,
  applyFrequencyLimits,
  groupByDay,
  MAX_WINDOW_DAYS,
  loadSchedule,
};

/**
 * Helper for the slots API route. Returns `null` if the date range exceeds
 * the maximum allowed.
 */
export function validateSlotsWindow(fromMs: number, toMs: number): { ok: true } | { ok: false; reason: string } {
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return { ok: false, reason: 'invalid_dates' };
  if (toMs <= fromMs) return { ok: false, reason: 'inverted_range' };
  const days = (toMs - fromMs) / (24 * 60 * 60 * 1000);
  if (days > MAX_WINDOW_DAYS) return { ok: false, reason: 'range_too_large' };
  return { ok: true };
}

export const SLOTS_MAX_WINDOW_DAYS = MAX_WINDOW_DAYS;
