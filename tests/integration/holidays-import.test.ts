import { describe, it, expect, beforeEach, mock, afterEach } from 'bun:test';
import { randomBytes } from 'node:crypto';

// ICS fixture with 3 holidays in year 2026
const ICS_FIXTURE = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260101
DTEND;VALUE=DATE:20260102
SUMMARY:New Year's Day
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260704
DTEND;VALUE=DATE:20260705
SUMMARY:Independence Day
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261225
DTEND;VALUE=DATE:20261226
SUMMARY:Christmas Day
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250101
DTEND;VALUE=DATE:20250102
SUMMARY:New Year's Day 2025
END:VEVENT
END:VCALENDAR`;

const MOCK_ICAL_URL = 'https://example.com/holidays.ics';

async function createTestUser() {
  const { db } = await import('@/lib/db');
  return db.user.create({
    data: {
      username: `holiday-test-${randomBytes(4).toString('hex')}`,
      passwordHash: 'placeholder',
      email: 'holiday@example.com',
      displayName: 'Holiday Test',
    },
  });
}

async function createTestSchedule(userId: string) {
  const { db } = await import('@/lib/db');
  return db.schedule.create({
    data: { userId, name: 'Test', isDefault: true, timezone: 'UTC' },
  });
}

// Mock global fetch
let originalFetch: typeof fetch;

function mockFetch(body: string, status = 200) {
  originalFetch = global.fetch;
  const fakeFetch = async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    new Response(body, {
      status,
      headers: { 'content-type': 'text/calendar' },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = fakeFetch as any;
}

function restoreFetch() {
  if (originalFetch) global.fetch = originalFetch;
}

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.bookingHistory.deleteMany({});
  await db.booking.deleteMany({});
  await db.eventTypeQuestion.deleteMany({});
  await db.eventType.deleteMany({});
  await db.dateOverride.deleteMany({});
  await db.scheduleRule.deleteMany({});
  await db.schedule.deleteMany({});
  await db.session.deleteMany({});
  await db.user.deleteMany({});
});

afterEach(() => {
  restoreFetch();
});

describe('importHolidaysFromIcal', () => {
  it('imports 3 holidays for year 2026 from a fixture ICS', async () => {
    mockFetch(ICS_FIXTURE);
    const { importHolidaysFromIcal } = await import('@/lib/availability/holidays');
    const { db } = await import('@/lib/db');
    const user = await createTestUser();
    const schedule = await createTestSchedule(user.id);

    const result = await importHolidaysFromIcal(schedule.id, MOCK_ICAL_URL, 2026);

    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);

    const overrides = await db.dateOverride.findMany({
      where: { scheduleId: schedule.id },
      orderBy: { date: 'asc' },
    });
    expect(overrides.length).toBe(3);
    for (const ov of overrides) {
      expect(ov.isBlocked).toBe(true);
      expect(ov.source).toBe('holiday-import');
    }
  });

  it('is idempotent — re-running does not duplicate overrides', async () => {
    const { importHolidaysFromIcal } = await import('@/lib/availability/holidays');
    const { db } = await import('@/lib/db');
    const user = await createTestUser();
    const schedule = await createTestSchedule(user.id);

    mockFetch(ICS_FIXTURE);
    const first = await importHolidaysFromIcal(schedule.id, MOCK_ICAL_URL, 2026);
    expect(first.imported).toBe(3);

    mockFetch(ICS_FIXTURE);
    const second = await importHolidaysFromIcal(schedule.id, MOCK_ICAL_URL, 2026);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(3);

    const count = await db.dateOverride.count({ where: { scheduleId: schedule.id } });
    expect(count).toBe(3);
  });

  it('does not replace a manual override on the same date', async () => {
    const { importHolidaysFromIcal } = await import('@/lib/availability/holidays');
    const { setDateOverride } = await import('@/lib/availability/overrides');
    const { db } = await import('@/lib/db');
    const user = await createTestUser();
    const schedule = await createTestSchedule(user.id);

    // Manually override one of the holiday dates (July 4)
    await setDateOverride(schedule.id, new Date('2026-07-04T00:00:00Z'), {
      isBlocked: false,
      startMinute: 540,
      endMinute: 720,
    });

    mockFetch(ICS_FIXTURE);
    const result = await importHolidaysFromIcal(schedule.id, MOCK_ICAL_URL, 2026);

    // 3 holidays in 2026, but July 4 has a manual override → skipped
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);

    // The manual override should not be replaced
    const julFourth = await db.dateOverride.findFirst({
      where: {
        scheduleId: schedule.id,
        date: new Date('2026-07-04T00:00:00Z'),
      },
    });
    expect(julFourth?.source).toBe('manual');
    expect(julFourth?.isBlocked).toBe(false);
    expect(julFourth?.startMinute).toBe(540);
  });

  it('rejects non-http(s) URL schemes', async () => {
    const { importHolidaysFromIcal } = await import('@/lib/availability/holidays');
    const user = await createTestUser();
    const schedule = await createTestSchedule(user.id);

    await expect(
      importHolidaysFromIcal(schedule.id, 'file:///etc/passwd', 2026),
    ).rejects.toThrow(/scheme/i);

    await expect(
      importHolidaysFromIcal(schedule.id, 'ftp://example.com/cal.ics', 2026),
    ).rejects.toThrow(/scheme/i);
  });
});
