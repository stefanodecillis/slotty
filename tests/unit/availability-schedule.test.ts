import { describe, it, expect, beforeEach } from 'bun:test';
import { randomBytes } from 'node:crypto';

async function createTestUser(timezone = 'UTC') {
  const { db } = await import('@/lib/db');
  return db.user.create({
    data: {
      username: `avail-test-${randomBytes(4).toString('hex')}`,
      passwordHash: 'placeholder',
      email: 'avail@example.com',
      displayName: 'Avail Test',
      timezone,
    },
  });
}

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.bookingHistory.deleteMany({});
  await db.booking.deleteMany({});
  await db.eventTypeQuestion.deleteMany({});
  await db.eventType.deleteMany({});
  await db.scheduleRule.deleteMany({});
  await db.dateOverride.deleteMany({});
  await db.schedule.deleteMany({});
  await db.session.deleteMany({});
  await db.user.deleteMany({});
});

describe('ensureDefaultSchedule', () => {
  it('creates a default schedule with Mon-Fri 09:00-18:00 when none exists', async () => {
    const { ensureDefaultSchedule } = await import('@/lib/availability/schedule');
    const user = await createTestUser('America/New_York');

    const schedule = await ensureDefaultSchedule(user.id, 'America/New_York');

    expect(schedule.isDefault).toBe(true);
    expect(schedule.userId).toBe(user.id);
    expect(schedule.timezone).toBe('America/New_York');
    expect(schedule.rules.length).toBe(5); // Mon-Fri

    const weekdays = schedule.rules.map((r) => r.weekday).sort();
    expect(weekdays).toEqual([1, 2, 3, 4, 5]);

    for (const rule of schedule.rules) {
      expect(rule.startMinute).toBe(9 * 60);  // 540
      expect(rule.endMinute).toBe(18 * 60);   // 1080
    }
  });

  it('returns the existing default schedule without creating a duplicate', async () => {
    const { ensureDefaultSchedule } = await import('@/lib/availability/schedule');
    const { db } = await import('@/lib/db');
    const user = await createTestUser();

    const first = await ensureDefaultSchedule(user.id, 'UTC');
    const second = await ensureDefaultSchedule(user.id, 'UTC');

    expect(first.id).toBe(second.id);

    const count = await db.schedule.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });
});

describe('updateScheduleRules', () => {
  it('atomically replaces all rules', async () => {
    const { ensureDefaultSchedule, updateScheduleRules } = await import('@/lib/availability/schedule');
    const { db } = await import('@/lib/db');
    const user = await createTestUser();

    const schedule = await ensureDefaultSchedule(user.id, 'UTC');
    expect(schedule.rules.length).toBe(5);

    const newRules = [
      { weekday: 0, startMinute: 10 * 60, endMinute: 14 * 60 }, // Sun 10-14
      { weekday: 6, startMinute: 10 * 60, endMinute: 14 * 60 }, // Sat 10-14
    ];

    const updated = await updateScheduleRules(schedule.id, newRules);

    expect(updated.length).toBe(2);
    const weekdays = updated.map((r) => r.weekday).sort();
    expect(weekdays).toEqual([0, 6]);

    // Old rules gone
    const totalRules = await db.scheduleRule.count({ where: { scheduleId: schedule.id } });
    expect(totalRules).toBe(2);
  });

  it('clears all rules when empty array is passed', async () => {
    const { ensureDefaultSchedule, updateScheduleRules } = await import('@/lib/availability/schedule');
    const { db } = await import('@/lib/db');
    const user = await createTestUser();

    const schedule = await ensureDefaultSchedule(user.id, 'UTC');
    await updateScheduleRules(schedule.id, []);

    const count = await db.scheduleRule.count({ where: { scheduleId: schedule.id } });
    expect(count).toBe(0);
  });

  it('rejects overlapping rules and does not partially update', async () => {
    const { ensureDefaultSchedule, updateScheduleRules } = await import('@/lib/availability/schedule');
    const { db } = await import('@/lib/db');
    const user = await createTestUser();

    const schedule = await ensureDefaultSchedule(user.id, 'UTC');
    const originalCount = await db.scheduleRule.count({ where: { scheduleId: schedule.id } });

    await expect(
      updateScheduleRules(schedule.id, [
        { weekday: 1, startMinute: 540, endMinute: 800 },
        { weekday: 1, startMinute: 700, endMinute: 1080 }, // overlaps
      ]),
    ).rejects.toThrow();

    // Rules should be unchanged
    const afterCount = await db.scheduleRule.count({ where: { scheduleId: schedule.id } });
    expect(afterCount).toBe(originalCount);
  });
});

describe('deleteSchedule', () => {
  it('deletes a non-default schedule', async () => {
    const { createSchedule, deleteSchedule } = await import('@/lib/availability/schedule');
    const { db } = await import('@/lib/db');
    const user = await createTestUser();

    const schedule = await createSchedule(user.id, 'Secondary', 'UTC');
    await deleteSchedule(schedule.id);

    const found = await db.schedule.findUnique({ where: { id: schedule.id } });
    expect(found).toBeNull();
  });

  it('refuses to delete the default schedule', async () => {
    const { ensureDefaultSchedule, deleteSchedule } = await import('@/lib/availability/schedule');
    const user = await createTestUser();

    const schedule = await ensureDefaultSchedule(user.id, 'UTC');

    await expect(deleteSchedule(schedule.id)).rejects.toThrow(
      'Cannot delete the default schedule',
    );
  });
});
