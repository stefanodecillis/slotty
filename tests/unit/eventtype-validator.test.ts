import { describe, it, expect } from 'bun:test';
import { eventTypeInputSchema } from '@/lib/eventtype/validator';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const VALID_BASE = {
  title: 'Intro Call',
  slug: 'intro-call',
  color: '#4F6CFF',
  hidden: false,
  durationMinutes: 30,
  locationKind: 'google_meet',
  destinationAccountId: 'acc-1',
  destinationCalendarId: 'cal-1',
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  minNoticeMin: 60,
  bookingWindowDays: 60,
  slotIntervalMin: 15,
  sendReminders: true,
  questions: [],
};

function parse(overrides: Record<string, unknown> = {}) {
  return eventTypeInputSchema.safeParse({ ...VALID_BASE, ...overrides });
}

// ─────────────────────────────────────────────────────────────
// Slug
// ─────────────────────────────────────────────────────────────

describe('slug validation', () => {
  it('accepts lowercase alphanumeric slug', () => {
    expect(parse({ slug: 'hello' }).success).toBe(true);
  });

  it('accepts slug with hyphens', () => {
    expect(parse({ slug: 'hello-world' }).success).toBe(true);
  });

  it('accepts slug with numbers', () => {
    expect(parse({ slug: 'hello-world-123' }).success).toBe(true);
  });

  it('rejects slug with uppercase letters', () => {
    expect(parse({ slug: 'Hello-World' }).success).toBe(false);
  });

  it('rejects slug with leading hyphen', () => {
    expect(parse({ slug: '-hello' }).success).toBe(false);
  });

  it('rejects slug with trailing hyphen', () => {
    expect(parse({ slug: 'hello-' }).success).toBe(false);
  });

  it('rejects slug with underscore', () => {
    expect(parse({ slug: 'hello_world' }).success).toBe(false);
  });

  it('rejects slug exceeding 60 characters', () => {
    expect(parse({ slug: 'a'.repeat(61) }).success).toBe(false);
  });

  it('accepts slug of exactly 60 characters', () => {
    expect(parse({ slug: 'a'.repeat(60) }).success).toBe(true);
  });

  it('rejects reserved slug "admin"', () => {
    const result = parse({ slug: 'admin' });
    expect(result.success).toBe(false);
  });

  it('rejects reserved slug "setup"', () => {
    expect(parse({ slug: 'setup' }).success).toBe(false);
  });

  it('rejects reserved slug "api"', () => {
    expect(parse({ slug: 'api' }).success).toBe(false);
  });

  it('rejects reserved slug "b"', () => {
    expect(parse({ slug: 'b' }).success).toBe(false);
  });

  it('rejects reserved slug "avatars"', () => {
    expect(parse({ slug: 'avatars' }).success).toBe(false);
  });

  it('accepts non-reserved slug like "booking"', () => {
    expect(parse({ slug: 'booking' }).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// locationKind enum
// ─────────────────────────────────────────────────────────────

describe('locationKind', () => {
  it('accepts google_meet', () => {
    expect(parse({ locationKind: 'google_meet' }).success).toBe(true);
  });

  it('accepts phone', () => {
    expect(parse({ locationKind: 'phone' }).success).toBe(true);
  });

  it('accepts in_person', () => {
    expect(parse({ locationKind: 'in_person', locationValue: '123 Main St' }).success).toBe(true);
  });

  it('accepts custom_link', () => {
    expect(
      parse({ locationKind: 'custom_link', locationValue: 'https://meet.example.com/xyz' }).success,
    ).toBe(true);
  });

  it('rejects unknown location kind', () => {
    expect(parse({ locationKind: 'zoom' }).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// locationValue requirements
// ─────────────────────────────────────────────────────────────

describe('locationValue requirements', () => {
  it('does not require locationValue for google_meet', () => {
    expect(parse({ locationKind: 'google_meet', locationValue: null }).success).toBe(true);
  });

  it('does not require locationValue for phone', () => {
    expect(parse({ locationKind: 'phone', locationValue: null }).success).toBe(true);
  });

  it('requires locationValue for in_person', () => {
    const result = parse({ locationKind: 'in_person', locationValue: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('locationValue');
    }
  });

  it('requires locationValue for custom_link', () => {
    const result = parse({ locationKind: 'custom_link', locationValue: null });
    expect(result.success).toBe(false);
  });

  it('requires custom_link locationValue to be a URL', () => {
    const result = parse({ locationKind: 'custom_link', locationValue: 'not-a-url' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('locationValue');
    }
  });

  it('accepts a valid URL for custom_link', () => {
    expect(
      parse({ locationKind: 'custom_link', locationValue: 'https://example.com/meet' }).success,
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Buffer range
// ─────────────────────────────────────────────────────────────

describe('buffer range', () => {
  it('accepts 0 for bufferBeforeMin', () => {
    expect(parse({ bufferBeforeMin: 0 }).success).toBe(true);
  });

  it('accepts 120 for bufferAfterMin', () => {
    expect(parse({ bufferAfterMin: 120 }).success).toBe(true);
  });

  it('rejects bufferBeforeMin > 120', () => {
    expect(parse({ bufferBeforeMin: 121 }).success).toBe(false);
  });

  it('rejects negative bufferAfterMin', () => {
    expect(parse({ bufferAfterMin: -1 }).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// minNoticeMin
// ─────────────────────────────────────────────────────────────

describe('minNoticeMin', () => {
  it('accepts 0', () => {
    expect(parse({ minNoticeMin: 0 }).success).toBe(true);
  });

  it('accepts 43200 (30 days)', () => {
    expect(parse({ minNoticeMin: 43200 }).success).toBe(true);
  });

  it('rejects 43201', () => {
    expect(parse({ minNoticeMin: 43201 }).success).toBe(false);
  });

  it('rejects negative', () => {
    expect(parse({ minNoticeMin: -1 }).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// durationMinutes
// ─────────────────────────────────────────────────────────────

describe('durationMinutes', () => {
  it('requires duration > 0', () => {
    expect(parse({ durationMinutes: 0 }).success).toBe(false);
  });

  it('accepts positive duration', () => {
    expect(parse({ durationMinutes: 30 }).success).toBe(true);
  });

  it('rejects duration > 1440', () => {
    expect(parse({ durationMinutes: 1441 }).success).toBe(false);
  });

  it('accepts duration = 1440', () => {
    expect(parse({ durationMinutes: 1440 }).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// slotIntervalMin
// ─────────────────────────────────────────────────────────────

describe('slotIntervalMin', () => {
  it('requires slotIntervalMin > 0', () => {
    expect(parse({ slotIntervalMin: 0 }).success).toBe(false);
  });

  it('accepts any positive slot interval', () => {
    expect(parse({ slotIntervalMin: 7 }).success).toBe(true);
    expect(parse({ slotIntervalMin: 15 }).success).toBe(true);
    expect(parse({ slotIntervalMin: 60 }).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// password
// ─────────────────────────────────────────────────────────────

describe('password', () => {
  it('accepts null password', () => {
    expect(parse({ password: null }).success).toBe(true);
  });

  it('accepts undefined password', () => {
    expect(parse({}).success).toBe(true);
  });

  it('rejects password shorter than 8 characters', () => {
    expect(parse({ password: 'short' }).success).toBe(false);
  });

  it('accepts password of 8+ characters', () => {
    expect(parse({ password: 'long-enough' }).success).toBe(true);
  });
});
