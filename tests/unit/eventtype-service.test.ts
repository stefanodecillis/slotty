import { describe, it, expect, beforeEach } from 'bun:test';
import { randomBytes } from 'node:crypto';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function createTestUser() {
  const { db } = await import('@/lib/db');
  return db.user.create({
    data: {
      username: `et-test-${randomBytes(4).toString('hex')}`,
      passwordHash: 'placeholder',
      email: 'et@example.com',
      displayName: 'ET Test',
      timezone: 'UTC',
    },
  });
}

async function createTestAccount(userId: string) {
  const { db } = await import('@/lib/db');
  // ConnectedAccount has no userId column; ownership is inferred from usage in MVP.
  return db.connectedAccount.create({
    data: {
      provider: 'google',
      googleUserEmail: `testaccount-${randomBytes(4).toString('hex')}@example.com`,
      accessTokenEnc: 'enc-access',
      refreshTokenEnc: 'enc-refresh',
      scopes: 'calendar',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      status: 'active',
    },
  });
}

async function createTestCalendar(connectedAccountId: string, isDestinationEligible = true) {
  const { db } = await import('@/lib/db');
  return db.calendar.create({
    data: {
      connectedAccountId,
      googleCalendarId: `cal-${randomBytes(4).toString('hex')}@group.calendar.google.com`,
      name: 'Test Calendar',
      isDestinationEligible,
    },
  });
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Intro Call',
    slug: `intro-${randomBytes(3).toString('hex')}`,
    color: '#4F6CFF',
    hidden: false,
    inviteOnly: false,
    durationMinutes: 30,
    locationKind: 'google_meet' as const,
    destinationAccountId: '',
    destinationCalendarId: '',
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    minNoticeMin: 60,
    bookingWindowDays: 60,
    slotIntervalMin: 15,
    maxGuests: 3,
    sendReminders: true,
    hiddenGuests: [],
    questions: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.bookingHistory.deleteMany({});
  await db.booking.deleteMany({});
  await db.eventTypeQuestion.deleteMany({});
  await db.eventType.deleteMany({});
  await db.calendar.deleteMany({});
  await db.connectedAccount.deleteMany({});
  await db.session.deleteMany({});
  await db.user.deleteMany({});
});

// ─────────────────────────────────────────────────────────────
// slugify
// ─────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', async () => {
    const { slugify } = await import('@/lib/eventtype/service');
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('collapses multiple spaces into a single hyphen', async () => {
    const { slugify } = await import('@/lib/eventtype/service');
    expect(slugify('a   b')).toBe('a-b');
  });

  it('removes leading and trailing hyphens', async () => {
    const { slugify } = await import('@/lib/eventtype/service');
    expect(slugify('!Hello World!')).toBe('hello-world');
  });

  it('handles special characters', async () => {
    const { slugify } = await import('@/lib/eventtype/service');
    expect(slugify('Hello World!')).toBe('hello-world');
  });

  it('truncates to 60 characters', async () => {
    const { slugify } = await import('@/lib/eventtype/service');
    const long = 'a'.repeat(70);
    expect(slugify(long).length).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────
// ensureUniqueSlug
// ─────────────────────────────────────────────────────────────

describe('ensureUniqueSlug', () => {
  it('returns base slug if not taken', async () => {
    const { ensureUniqueSlug } = await import('@/lib/eventtype/service');
    const user = await createTestUser();
    const result = await ensureUniqueSlug(user.id, 'unique-slug-xyz');
    expect(result).toBe('unique-slug-xyz');
  });

  it('appends -2 if base slug is taken', async () => {
    const { ensureUniqueSlug } = await import('@/lib/eventtype/service');
    const { db } = await import('@/lib/db');

    const user = await createTestUser();
    const account = await createTestAccount(user.id);
    const calendar = await createTestCalendar(account.id);

    // Occupy 'intro' by creating an event type
    await db.eventType.create({
      data: {
        userId: user.id,
        title: 'Intro',
        slug: 'intro',
        durationMinutes: 30,
        destinationAccountId: account.id,
        destinationCalendarId: calendar.id,
        locationKind: 'google_meet',
      },
    });

    const result = await ensureUniqueSlug(user.id, 'intro');
    expect(result).toBe('intro-2');
  });
});

// ─────────────────────────────────────────────────────────────
// createEventType
// ─────────────────────────────────────────────────────────────

describe('createEventType', () => {
  it('creates event type and questions atomically', async () => {
    const { createEventType } = await import('@/lib/eventtype/service');
    const { db } = await import('@/lib/db');

    const user = await createTestUser();
    const account = await createTestAccount(user.id);
    const calendar = await createTestCalendar(account.id);

    const created = await createEventType(
      user.id,
      makeInput({
        destinationAccountId: account.id,
        destinationCalendarId: calendar.id,
        questions: [
          {
            label: 'Company name',
            kind: 'text' as const,
            required: true,
            position: 0,
          },
        ],
      }),
    );

    expect(created.userId).toBe(user.id);
    expect(created.durationMinutes).toBe(30);

    const questions = await db.eventTypeQuestion.findMany({
      where: { eventTypeId: created.id },
    });
    expect(questions.length).toBe(1);
    expect(questions[0]?.label).toBe('Company name');
  });

  it('rejects if destination calendar is not eligible', async () => {
    const { createEventType, ServiceError } = await import('@/lib/eventtype/service');

    const user = await createTestUser();
    const account = await createTestAccount(user.id);
    const calendar = await createTestCalendar(account.id, false); // not eligible

    await expect(
      createEventType(
        user.id,
        makeInput({
          destinationAccountId: account.id,
          destinationCalendarId: calendar.id,
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it('rejects if destination calendar does not belong to account', async () => {
    const { createEventType, ServiceError } = await import('@/lib/eventtype/service');

    const user = await createTestUser();
    const account1 = await createTestAccount(user.id);
    const account2 = await createTestAccount(user.id);
    const calendar = await createTestCalendar(account1.id); // belongs to account1

    await expect(
      createEventType(
        user.id,
        makeInput({
          destinationAccountId: account2.id, // wrong account
          destinationCalendarId: calendar.id,
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

// ─────────────────────────────────────────────────────────────
// duplicateEventType
// ─────────────────────────────────────────────────────────────

describe('duplicateEventType', () => {
  it('creates a copy with (copy) suffix, new id, and copies questions', async () => {
    const { createEventType, duplicateEventType } = await import('@/lib/eventtype/service');
    const { db } = await import('@/lib/db');

    const user = await createTestUser();
    const account = await createTestAccount(user.id);
    const calendar = await createTestCalendar(account.id);

    const original = await createEventType(
      user.id,
      makeInput({
        title: 'Intro Call',
        destinationAccountId: account.id,
        destinationCalendarId: calendar.id,
        questions: [{ label: 'Q1', kind: 'text' as const, required: false, position: 0 }],
      }),
    );

    const copy = await duplicateEventType(original.id, user.id);

    expect(copy.id).not.toBe(original.id);
    expect(copy.title).toBe('Intro Call (copy)');
    expect(copy.slug).not.toBe(original.slug);

    const copyQuestions = await db.eventTypeQuestion.findMany({
      where: { eventTypeId: copy.id },
    });
    expect(copyQuestions.length).toBe(1);
    expect(copyQuestions[0]?.label).toBe('Q1');
  });
});

// ─────────────────────────────────────────────────────────────
// archiveEventType / unarchiveEventType
// ─────────────────────────────────────────────────────────────

describe('archive / unarchive', () => {
  it('archives then unarchives an event type', async () => {
    const { createEventType, archiveEventType, unarchiveEventType } = await import(
      '@/lib/eventtype/service'
    );
    const { db } = await import('@/lib/db');

    const user = await createTestUser();
    const account = await createTestAccount(user.id);
    const calendar = await createTestCalendar(account.id);

    const et = await createEventType(
      user.id,
      makeInput({ destinationAccountId: account.id, destinationCalendarId: calendar.id }),
    );

    await archiveEventType(et.id, user.id);
    let row = await db.eventType.findUnique({ where: { id: et.id } });
    expect(row?.archived).toBe(true);

    await unarchiveEventType(et.id, user.id);
    row = await db.eventType.findUnique({ where: { id: et.id } });
    expect(row?.archived).toBe(false);
  });

  it('throws NOT_FOUND when archiving an event type that belongs to another user', async () => {
    const { createEventType, archiveEventType, ServiceError } = await import(
      '@/lib/eventtype/service'
    );

    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const account = await createTestAccount(user1.id);
    const calendar = await createTestCalendar(account.id);

    const et = await createEventType(
      user1.id,
      makeInput({ destinationAccountId: account.id, destinationCalendarId: calendar.id }),
    );

    await expect(archiveEventType(et.id, user2.id)).rejects.toBeInstanceOf(ServiceError);
  });
});

// ─────────────────────────────────────────────────────────────
// reorderEventTypes
// ─────────────────────────────────────────────────────────────

describe('reorderEventTypes', () => {
  it('updates positions according to the provided order', async () => {
    const { createEventType, reorderEventTypes } = await import('@/lib/eventtype/service');
    const { db } = await import('@/lib/db');

    const user = await createTestUser();
    const account = await createTestAccount(user.id);
    const calendar = await createTestCalendar(account.id);

    const a = await createEventType(
      user.id,
      makeInput({ destinationAccountId: account.id, destinationCalendarId: calendar.id }),
    );
    const b = await createEventType(
      user.id,
      makeInput({ destinationAccountId: account.id, destinationCalendarId: calendar.id }),
    );
    const c = await createEventType(
      user.id,
      makeInput({ destinationAccountId: account.id, destinationCalendarId: calendar.id }),
    );

    // Reorder: c, a, b
    await reorderEventTypes(user.id, [c.id, a.id, b.id]);

    const rows = await db.eventType.findMany({
      where: { id: { in: [a.id, b.id, c.id] } },
      orderBy: { position: 'asc' },
    });

    expect(rows[0]?.id).toBe(c.id);
    expect(rows[1]?.id).toBe(a.id);
    expect(rows[2]?.id).toBe(b.id);
  });
});

// ─────────────────────────────────────────────────────────────
// hiddenGuests round-trip
// ─────────────────────────────────────────────────────────────

describe('hiddenGuests round-trip', () => {
  it('canonicalizes (lowercases, dedupes) on create and parses back on read', async () => {
    const { createEventType, parseHiddenGuests } = await import('@/lib/eventtype/service');
    const { db } = await import('@/lib/db');

    const user = await createTestUser();
    const account = await createTestAccount(user.id);
    const calendar = await createTestCalendar(account.id);

    const created = await createEventType(
      user.id,
      makeInput({
        destinationAccountId: account.id,
        destinationCalendarId: calendar.id,
        // Mixed case + a duplicate to ensure canonicalization.
        hiddenGuests: ['Ops@Example.com', 'cto@example.com', 'OPS@example.com'],
      }),
    );

    const row = await db.eventType.findUniqueOrThrow({ where: { id: created.id } });
    const parsed = parseHiddenGuests(row.hiddenGuestsJson);
    expect(parsed).toEqual(['ops@example.com', 'cto@example.com']);
  });

  it('updates the stored hidden guests list on update', async () => {
    const { createEventType, updateEventType, parseHiddenGuests } = await import(
      '@/lib/eventtype/service'
    );
    const { db } = await import('@/lib/db');

    const user = await createTestUser();
    const account = await createTestAccount(user.id);
    const calendar = await createTestCalendar(account.id);

    const created = await createEventType(
      user.id,
      makeInput({
        destinationAccountId: account.id,
        destinationCalendarId: calendar.id,
        hiddenGuests: ['a@example.com'],
      }),
    );

    await updateEventType(
      created.id,
      user.id,
      makeInput({
        slug: created.slug,
        destinationAccountId: account.id,
        destinationCalendarId: calendar.id,
        hiddenGuests: ['b@example.com', 'c@example.com'],
      }),
    );

    const row = await db.eventType.findUniqueOrThrow({ where: { id: created.id } });
    expect(parseHiddenGuests(row.hiddenGuestsJson)).toEqual(['b@example.com', 'c@example.com']);
  });

  it('preserves hidden guests on duplicate', async () => {
    const { createEventType, duplicateEventType, parseHiddenGuests } = await import(
      '@/lib/eventtype/service'
    );
    const { db } = await import('@/lib/db');

    const user = await createTestUser();
    const account = await createTestAccount(user.id);
    const calendar = await createTestCalendar(account.id);

    const created = await createEventType(
      user.id,
      makeInput({
        destinationAccountId: account.id,
        destinationCalendarId: calendar.id,
        hiddenGuests: ['copyme@example.com'],
      }),
    );

    const dup = await duplicateEventType(created.id, user.id);
    const row = await db.eventType.findUniqueOrThrow({ where: { id: dup.id } });
    expect(parseHiddenGuests(row.hiddenGuestsJson)).toEqual(['copyme@example.com']);
  });
});

// ─────────────────────────────────────────────────────────────
// deleteEventType — cascade behaviour
// ─────────────────────────────────────────────────────────────

describe('deleteEventType cascades bookings + history + invites', () => {
  it('drops bookings, booking-history rows, and invites when the event type is deleted', async () => {
    const { createEventType, deleteEventType } = await import('@/lib/eventtype/service');
    const { db } = await import('@/lib/db');

    const user = await createTestUser();
    const account = await createTestAccount(user.id);
    const calendar = await createTestCalendar(account.id);

    const et = await createEventType(
      user.id,
      makeInput({ destinationAccountId: account.id, destinationCalendarId: calendar.id }),
    );

    // Seed two bookings + history + an invite.
    const bookingA = await db.booking.create({
      data: {
        eventTypeId: et.id,
        googleAccountId: account.id,
        googleCalendarId: calendar.id,
        startAt: new Date(Date.now() + 24 * 3600 * 1000),
        endAt: new Date(Date.now() + 25 * 3600 * 1000),
        bookerName: 'Alice',
        bookerEmail: 'alice@example.com',
        bookerTimezone: 'UTC',
        cancelTokenHash: 'cancel-a',
        rescheduleTokenHash: 'resched-a',
      },
    });
    const bookingB = await db.booking.create({
      data: {
        eventTypeId: et.id,
        googleAccountId: account.id,
        googleCalendarId: calendar.id,
        startAt: new Date(Date.now() + 48 * 3600 * 1000),
        endAt: new Date(Date.now() + 49 * 3600 * 1000),
        bookerName: 'Bob',
        bookerEmail: 'bob@example.com',
        bookerTimezone: 'UTC',
        cancelTokenHash: 'cancel-b',
        rescheduleTokenHash: 'resched-b',
      },
    });
    await db.bookingHistory.create({
      data: { bookingId: bookingA.id, action: 'created', actor: 'booker' },
    });
    await db.bookingHistory.create({
      data: { bookingId: bookingB.id, action: 'created', actor: 'booker' },
    });
    const invite = await db.bookingInvite.create({
      data: { eventTypeId: et.id, tokenHash: 'hash-' + randomBytes(4).toString('hex') },
    });

    await deleteEventType(et.id, user.id);

    expect(await db.eventType.findUnique({ where: { id: et.id } })).toBeNull();
    expect(
      await db.booking.findMany({ where: { id: { in: [bookingA.id, bookingB.id] } } }),
    ).toEqual([]);
    expect(
      await db.bookingHistory.findMany({ where: { bookingId: { in: [bookingA.id, bookingB.id] } } }),
    ).toEqual([]);
    expect(await db.bookingInvite.findUnique({ where: { id: invite.id } })).toBeNull();

    // ConnectedAccount and Calendar are untouched.
    expect(await db.connectedAccount.findUnique({ where: { id: account.id } })).not.toBeNull();
    expect(await db.calendar.findUnique({ where: { id: calendar.id } })).not.toBeNull();
  });
});
