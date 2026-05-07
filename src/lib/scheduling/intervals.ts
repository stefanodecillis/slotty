/**
 * Half-open UTC time intervals: `[start, end)`.
 *
 * Slot computation operates on intervals throughout: schedule windows, busy
 * blocks, and candidate-start ranges are all expressed as arrays of these
 * (sorted, merged) intervals. All times are stored as ms-since-epoch so the
 * helpers don't accidentally introduce tz drift.
 */

export interface Interval {
  start: number; // ms since epoch (UTC)
  end: number;   // ms since epoch (UTC), exclusive
}

/**
 * Sort and merge overlapping or adjacent intervals.
 * "Adjacent" (end === next.start) is treated as a single contiguous run.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  // Drop empty/inverted ranges before merging.
  const valid = intervals.filter((i) => i.end > i.start);
  if (valid.length === 0) return [];

  valid.sort((a, b) => a.start - b.start);

  const out: Interval[] = [];
  let current = { start: valid[0]!.start, end: valid[0]!.end };

  for (let i = 1; i < valid.length; i += 1) {
    const next = valid[i]!;
    if (next.start <= current.end) {
      // Overlap or touching — extend.
      if (next.end > current.end) current.end = next.end;
    } else {
      out.push(current);
      current = { start: next.start, end: next.end };
    }
  }
  out.push(current);

  return out;
}

/**
 * Set difference: a \ b.
 *
 * Both inputs are assumed sorted+merged. Returns the parts of `a` that are
 * NOT covered by any interval in `b`, sorted+merged.
 */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  if (a.length === 0) return [];
  if (b.length === 0) return a.map((x) => ({ start: x.start, end: x.end }));

  const result: Interval[] = [];
  let bIdx = 0;

  for (const aInt of a) {
    let cursor = aInt.start;
    const aEnd = aInt.end;

    // Advance past any b-intervals that end at or before our cursor.
    while (bIdx < b.length && b[bIdx]!.end <= cursor) bIdx += 1;

    let j = bIdx;
    while (j < b.length && b[j]!.start < aEnd) {
      const bStart = b[j]!.start;
      const bEnd = b[j]!.end;

      if (bStart > cursor) {
        result.push({ start: cursor, end: Math.min(bStart, aEnd) });
      }
      if (bEnd > cursor) cursor = bEnd;
      if (cursor >= aEnd) break;
      j += 1;
    }

    if (cursor < aEnd) {
      result.push({ start: cursor, end: aEnd });
    }
  }

  return result;
}

/**
 * Set intersection of two sorted+merged interval arrays.
 */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  if (a.length === 0 || b.length === 0) return [];
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ai = a[i]!;
    const bj = b[j]!;
    const start = Math.max(ai.start, bj.start);
    const end = Math.min(ai.end, bj.end);
    if (start < end) result.push({ start, end });
    if (ai.end < bj.end) i += 1;
    else j += 1;
  }
  return result;
}

/** Convenience constructor that drops empty/inverted ranges. */
export function makeInterval(start: number, end: number): Interval | null {
  if (end <= start) return null;
  return { start, end };
}

/** Total covered duration in milliseconds. */
export function totalDuration(intervals: Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
}
