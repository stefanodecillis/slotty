import { describe, it, expect } from 'bun:test';
import { weeklyRulesSchema, dateOverrideSchema, timezoneSchema } from '@/lib/availability/validators';

describe('weeklyRulesSchema', () => {
  it('accepts valid non-overlapping rules', () => {
    const result = weeklyRulesSchema.safeParse([
      { weekday: 1, startMinute: 540, endMinute: 720 },
      { weekday: 1, startMinute: 780, endMinute: 1080 },
      { weekday: 2, startMinute: 0, endMinute: 60 },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects overlapping rules on the same weekday', () => {
    const result = weeklyRulesSchema.safeParse([
      { weekday: 1, startMinute: 540, endMinute: 800 },
      { weekday: 1, startMinute: 700, endMinute: 1080 }, // overlaps with previous
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects adjacent touching rules that do not overlap', () => {
    // end of first == start of second is NOT an overlap
    const result = weeklyRulesSchema.safeParse([
      { weekday: 1, startMinute: 540, endMinute: 720 },
      { weekday: 1, startMinute: 720, endMinute: 1080 },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects rule where startMinute >= endMinute', () => {
    const result = weeklyRulesSchema.safeParse([
      { weekday: 1, startMinute: 720, endMinute: 540 },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects rule where startMinute == endMinute', () => {
    const result = weeklyRulesSchema.safeParse([
      { weekday: 1, startMinute: 540, endMinute: 540 },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects weekday out of range', () => {
    const result = weeklyRulesSchema.safeParse([
      { weekday: 7, startMinute: 540, endMinute: 1080 },
    ]);
    expect(result.success).toBe(false);
  });

  it('accepts empty rules array', () => {
    const result = weeklyRulesSchema.safeParse([]);
    expect(result.success).toBe(true);
  });
});

describe('timezoneSchema', () => {
  it('accepts valid IANA timezone strings', () => {
    expect(timezoneSchema.safeParse('America/New_York').success).toBe(true);
    expect(timezoneSchema.safeParse('Europe/London').success).toBe(true);
    expect(timezoneSchema.safeParse('UTC').success).toBe(true);
    expect(timezoneSchema.safeParse('Asia/Tokyo').success).toBe(true);
  });

  it('rejects non-IANA timezone strings', () => {
    expect(timezoneSchema.safeParse('Not/ATimezone').success).toBe(false);
    expect(timezoneSchema.safeParse('').success).toBe(false);
    expect(timezoneSchema.safeParse('invalid').success).toBe(false);
    expect(timezoneSchema.safeParse('Moon/Base').success).toBe(false);
  });
});

describe('dateOverrideSchema', () => {
  it('accepts a blocked override', () => {
    const result = dateOverrideSchema.safeParse({ isBlocked: true });
    expect(result.success).toBe(true);
  });

  it('accepts custom-hours override with valid start/end', () => {
    const result = dateOverrideSchema.safeParse({
      isBlocked: false,
      startMinute: 540,
      endMinute: 1080,
    });
    expect(result.success).toBe(true);
  });

  it('rejects custom-hours override when endMinute <= startMinute', () => {
    const result = dateOverrideSchema.safeParse({
      isBlocked: false,
      startMinute: 1080,
      endMinute: 540,
    });
    expect(result.success).toBe(false);
  });

  it('rejects custom-hours override with only startMinute set', () => {
    const result = dateOverrideSchema.safeParse({
      isBlocked: false,
      startMinute: 540,
    });
    expect(result.success).toBe(false);
  });
});
