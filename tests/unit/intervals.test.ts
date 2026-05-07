import { describe, it, expect } from 'bun:test';

import {
  mergeIntervals,
  subtract,
  intersect,
  totalDuration,
  type Interval,
} from '@/lib/scheduling/intervals';

const i = (start: number, end: number): Interval => ({ start, end });

describe('mergeIntervals', () => {
  it('returns empty for empty', () => {
    expect(mergeIntervals([])).toEqual([]);
  });

  it('passes through a single interval', () => {
    expect(mergeIntervals([i(10, 20)])).toEqual([i(10, 20)]);
  });

  it('merges overlapping intervals', () => {
    expect(mergeIntervals([i(0, 10), i(5, 15)])).toEqual([i(0, 15)]);
  });

  it('merges adjacent (touching) intervals', () => {
    expect(mergeIntervals([i(0, 10), i(10, 20)])).toEqual([i(0, 20)]);
  });

  it('keeps disjoint intervals separate', () => {
    expect(mergeIntervals([i(0, 5), i(10, 15)])).toEqual([i(0, 5), i(10, 15)]);
  });

  it('drops empty / inverted ranges', () => {
    expect(mergeIntervals([i(5, 5), i(10, 5), i(0, 5)])).toEqual([i(0, 5)]);
  });

  it('handles unsorted input', () => {
    expect(mergeIntervals([i(20, 30), i(0, 10), i(5, 8)])).toEqual([i(0, 10), i(20, 30)]);
  });
});

describe('subtract', () => {
  it('returns a unchanged when b is empty', () => {
    expect(subtract([i(0, 10)], [])).toEqual([i(0, 10)]);
  });

  it('returns empty when a is empty', () => {
    expect(subtract([], [i(0, 10)])).toEqual([]);
  });

  it('removes complete overlap', () => {
    expect(subtract([i(0, 10)], [i(0, 10)])).toEqual([]);
    expect(subtract([i(2, 8)], [i(0, 10)])).toEqual([]);
  });

  it('handles partial-left overlap', () => {
    expect(subtract([i(0, 10)], [i(0, 4)])).toEqual([i(4, 10)]);
    expect(subtract([i(2, 10)], [i(0, 5)])).toEqual([i(5, 10)]);
  });

  it('handles partial-right overlap', () => {
    expect(subtract([i(0, 10)], [i(6, 10)])).toEqual([i(0, 6)]);
    expect(subtract([i(0, 10)], [i(6, 12)])).toEqual([i(0, 6)]);
  });

  it('punches a hole in the middle', () => {
    expect(subtract([i(0, 20)], [i(5, 10)])).toEqual([i(0, 5), i(10, 20)]);
  });

  it('handles multiple b-intervals against one a', () => {
    expect(subtract([i(0, 30)], [i(5, 10), i(15, 20)])).toEqual([
      i(0, 5),
      i(10, 15),
      i(20, 30),
    ]);
  });

  it('handles multiple a-intervals against one b', () => {
    expect(subtract([i(0, 10), i(20, 30)], [i(5, 25)])).toEqual([i(0, 5), i(25, 30)]);
  });

  it('returns nothing if every a is inside b', () => {
    expect(subtract([i(2, 5), i(10, 15)], [i(0, 100)])).toEqual([]);
  });

  it('handles touching boundaries (half-open semantics)', () => {
    // b ends exactly where a starts: no overlap.
    expect(subtract([i(10, 20)], [i(0, 10)])).toEqual([i(10, 20)]);
    // b starts exactly where a ends: no overlap.
    expect(subtract([i(0, 10)], [i(10, 20)])).toEqual([i(0, 10)]);
  });
});

describe('intersect', () => {
  it('returns empty when either side is empty', () => {
    expect(intersect([], [i(0, 10)])).toEqual([]);
    expect(intersect([i(0, 10)], [])).toEqual([]);
  });

  it('returns full overlap', () => {
    expect(intersect([i(0, 10)], [i(0, 10)])).toEqual([i(0, 10)]);
  });

  it('returns partial overlap', () => {
    expect(intersect([i(0, 10)], [i(5, 15)])).toEqual([i(5, 10)]);
    expect(intersect([i(5, 20)], [i(0, 10)])).toEqual([i(5, 10)]);
  });

  it('returns multi-interval intersections', () => {
    expect(
      intersect([i(0, 10), i(20, 30)], [i(5, 25)]),
    ).toEqual([i(5, 10), i(20, 25)]);
  });

  it('returns empty when disjoint', () => {
    expect(intersect([i(0, 5)], [i(10, 15)])).toEqual([]);
  });
});

describe('totalDuration', () => {
  it('sums interval widths', () => {
    expect(totalDuration([i(0, 5), i(10, 17)])).toBe(12);
  });
});
