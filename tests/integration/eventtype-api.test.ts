/**
 * Integration tests for EventType service layer.
 * Tests are performed via direct service calls (not HTTP) to avoid the
 * complexity of a running Next.js server in CI.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { randomBytes } from 'node:crypto';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function createUser() {
  const { db } = await import('@/lib/db');
  return db.user.create({
    data: {
      username: `int-et-${randomBytes(4).toString('hex')}`,
      passwordHash: 'placeholder',
      email: 'int-et@example.com',
      displayName: 'Integration Test',
      timezone: 'UTC',
    },
  });
}

async function createAccount() {
  const { db } = await import('@/lib/db');
  return db.connectedAccount.create({
    data: {
      provider: 'google',
      googleUserEmail: `acc-${randomBytes(4).toString('hex')}@example.com`,
      accessTokenEnc: 'enc-access',
      refreshTokenEnc: 'enc-refresh',
      scopes: 'calendar',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      status: 'active',
    },
  });
}

async function createCalendar(connectedAccountId: string, isDestinationEligible = true) {
  const { db } = await import('@/lib/db');
  return db.calendar.create({
    data: {
      connectedAccountId,
      googleCalendarId: `cal-${randomBytes(4).toString('hex')}@group.calendar.google.com`,
      name: 'Integration Calendar',
      isDestinationEligible,
    },
  });
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Integration Test Event',
    slug: `int-${randomBytes(3).toString('hex')}`,
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
// Tests
// ─────────────────────────────────────────────────────────────

describe('destination validation', () => {
  it('rejects cross-account calendar assignment', async () => {
    const { createEventType, ServiceError } = await import('@/lib/eventtype/service');

    const user = await createUser();
    const account1 = await createAccount();
    const account2 = await createAccount();
    const calendar = await createCalendar(account1.id); // belongs to account1

    // Attempt to use account2 with account1's calendar
    await expect(
      createEventType(
        user.id,
        baseInput({
          destinationAccountId: account2.id,
          destinationCalendarId: calendar.id,
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it('rejects calendar that is not destination-eligible', async () => {
    const { createEventType, ServiceError } = await import('@/lib/eventtype/service');

    const user = await createUser();
    const account = await createAccount();
    const calendar = await createCalendar(account.id, false); // not eligible

    await expect(
      createEventType(
        user.id,
        baseInput({
          destinationAccountId: account.id,
          destinationCalendarId: calendar.id,
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it('accepts a valid destination', async () => {
    const { createEventType } = await import('@/lib/eventtype/service');

    const user = await createUser();
    const account = await createAccount();
    const calendar = await createCalendar(account.id, true);

    const et = await createEventType(
      user.id,
      baseInput({
        destinationAccountId: account.id,
        destinationCalendarId: calendar.id,
      }),
    );

    expect(et.destinationAccountId).toBe(account.id);
    expect(et.destinationCalendarId).toBe(calendar.id);
  });
});

describe('disconnect cascade', () => {
  it('archives event types when their destination account is disconnected', async () => {
    const { createEventType, archiveEventTypesForAccount } = await import(
      '@/lib/eventtype/service'
    );
    const { db } = await import('@/lib/db');

    const user = await createUser();
    const account = await createAccount();
    const calendar = await createCalendar(account.id, true);

    const et = await createEventType(
      user.id,
      baseInput({
        destinationAccountId: account.id,
        destinationCalendarId: calendar.id,
      }),
    );

    expect(et.archived).toBe(false);

    // Simulate disconnect
    const count = await archiveEventTypesForAccount(account.id);
    expect(count).toBe(1);

    const updated = await db.eventType.findUnique({ where: { id: et.id } });
    expect(updated?.archived).toBe(true);
  });

  it('does not archive already-archived event types (count stays accurate)', async () => {
    const { createEventType, archiveEventType, archiveEventTypesForAccount } = await import(
      '@/lib/eventtype/service'
    );

    const user = await createUser();
    const account = await createAccount();
    const calendar = await createCalendar(account.id, true);

    const et1 = await createEventType(
      user.id,
      baseInput({ destinationAccountId: account.id, destinationCalendarId: calendar.id }),
    );
    const et2 = await createEventType(
      user.id,
      baseInput({ destinationAccountId: account.id, destinationCalendarId: calendar.id }),
    );

    // Archive et1 manually first
    await archiveEventType(et1.id, user.id);

    // Cascade should only report et2 as newly archived
    const count = await archiveEventTypesForAccount(account.id);
    expect(count).toBe(1); // only et2 was not already archived
  });
});

describe('slug uniqueness', () => {
  it('generates a unique slug when base slug is already taken', async () => {
    const { createEventType } = await import('@/lib/eventtype/service');

    const user = await createUser();
    const account = await createAccount();
    const calendar = await createCalendar(account.id, true);

    const slug = `unique-slug-${randomBytes(3).toString('hex')}`;

    const first = await createEventType(
      user.id,
      baseInput({ slug, destinationAccountId: account.id, destinationCalendarId: calendar.id }),
    );

    // Try to create with same slug — service should auto-deduplicate
    const second = await createEventType(
      user.id,
      baseInput({ slug, destinationAccountId: account.id, destinationCalendarId: calendar.id }),
    );

    expect(first.slug).toBe(slug);
    expect(second.slug).toBe(`${slug}-2`);
  });
});
