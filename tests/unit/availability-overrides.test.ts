import { describe, it, expect, beforeEach } from 'bun:test';
import { randomBytes } from 'node:crypto';

async function createTestUser() {
  const { db } = await import('@/lib/db');
  return db.user.create({
    data: {
      username: `override-test-${randomBytes(4).toString('hex')}`,
      passwordHash: 'placeholder',
      email: 'override@example.com',
      displayName: 'Override Test',
    },
  });
}

async function createTestSchedule(userId: string) {
  const { db } = await import('@/lib/db');
  return db.schedule.create({
    data: { userId, name: 'Test', isDefault: true, timezone: 'UTC' },
  });
}

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.dateOverride.deleteMany({});
  await db.scheduleRule.deleteMany({});
  await db.schedule.deleteMany({});
  await db.session.deleteMany({});
  await db.user.deleteMany({});
});

describe('setDateOverride', () => {
  it('creates a new override', async () => {
    const { setDateOverride } = await import('@/lib/availability/overrides');
    const user = await createTestUser();
    const schedule = await createTestSchedule(user.id);
    const date = new Date('2026-07-04T00:00:00Z');

    const override = await setDateOverride(schedule.id, date, { isBlocked: true });

    expect(override.isBlocked).toBe(true);
    expect(override.source).toBe('manual');
    expect(override.scheduleId).toBe(schedule.id);
  });

  it('updates an existing override (same day not duplicated)', async () => {
    const { setDateOverride } = await import('@/lib/availability/overrides');
    const { db } = await import('@/lib/db');
    const user = await createTestUser();
    const schedule = await createTestSchedule(user.id);
    const date = new Date('2026-07-04T00:00:00Z');

    await setDateOverride(schedule.id, date, { isBlocked: true });
    await setDateOverride(schedule.id, date, {
      isBlocked: false,
      startMinute: 540,
      endMinute: 1080,
    });

    const count = await db.dateOverride.count({ where: { scheduleId: schedule.id } });
    expect(count).toBe(1);

    const found = await db.dateOverride.findFirst({ where: { scheduleId: schedule.id } });
    expect(found?.isBlocked).toBe(false);
    expect(found?.startMinute).toBe(540);
    expect(found?.endMinute).toBe(1080);
  });

  it('normalises date to midnight UTC regardless of time component', async () => {
    const { setDateOverride } = await import('@/lib/availability/overrides');
    const { db } = await import('@/lib/db');
    const user = await createTestUser();
    const schedule = await createTestSchedule(user.id);

    // Same calendar date, different times
    const dateA = new Date('2026-08-15T10:30:00Z');
    const dateB = new Date('2026-08-15T22:45:00Z');

    await setDateOverride(schedule.id, dateA, { isBlocked: true });
    await setDateOverride(schedule.id, dateB, { isBlocked: false, startMinute: 0, endMinute: 60 });

    // Should be same row (upsert)
    const count = await db.dateOverride.count({ where: { scheduleId: schedule.id } });
    expect(count).toBe(1);
  });
});

describe('removeDateOverride', () => {
  it('removes an existing override', async () => {
    const { setDateOverride, removeDateOverride } = await import('@/lib/availability/overrides');
    const { db } = await import('@/lib/db');
    const user = await createTestUser();
    const schedule = await createTestSchedule(user.id);
    const date = new Date('2026-09-01T00:00:00Z');

    await setDateOverride(schedule.id, date, { isBlocked: true });
    await removeDateOverride(schedule.id, date);

    const count = await db.dateOverride.count({ where: { scheduleId: schedule.id } });
    expect(count).toBe(0);
  });

  it('is a no-op if override does not exist', async () => {
    const { removeDateOverride } = await import('@/lib/availability/overrides');
    const user = await createTestUser();
    const schedule = await createTestSchedule(user.id);

    let threw = false;
    try {
      await removeDateOverride(schedule.id, new Date('2026-12-25T00:00:00Z'));
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe('listDateOverrides', () => {
  it('returns overrides within the given range', async () => {
    const { setDateOverride, listDateOverrides } = await import('@/lib/availability/overrides');
    const user = await createTestUser();
    const schedule = await createTestSchedule(user.id);

    await setDateOverride(schedule.id, new Date('2026-10-01T00:00:00Z'), { isBlocked: true });
    await setDateOverride(schedule.id, new Date('2026-10-15T00:00:00Z'), { isBlocked: true });
    await setDateOverride(schedule.id, new Date('2026-11-01T00:00:00Z'), { isBlocked: true });

    const results = await listDateOverrides(
      schedule.id,
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-31T00:00:00Z'),
    );

    expect(results.length).toBe(2);
  });
});
