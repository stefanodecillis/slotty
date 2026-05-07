import { db } from '@/lib/db';
import type { Schedule, ScheduleRule } from '@prisma/client';
import { weeklyRulesSchema, type RuleInput } from './validators';

// Default Mon–Fri 09:00–18:00 (weekdays 1–5, 540–1080 minutes)
const DEFAULT_RULES: RuleInput[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,  // 540
  endMinute: 18 * 60,   // 1080
}));

// ──────────────────────────────────────────────────
// Read helpers
// ──────────────────────────────────────────────────

export async function getDefaultSchedule(userId: string): Promise<
  (Schedule & { rules: ScheduleRule[] }) | null
> {
  return db.schedule.findFirst({
    where: { userId, isDefault: true },
    include: { rules: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] } },
  });
}

// ──────────────────────────────────────────────────
// Ensure-or-create default schedule
// ──────────────────────────────────────────────────

export async function ensureDefaultSchedule(
  userId: string,
  timezone: string,
): Promise<Schedule & { rules: ScheduleRule[] }> {
  const existing = await getDefaultSchedule(userId);
  if (existing) return existing;

  // Create default schedule with Mon-Fri 09:00-18:00
  const schedule = await db.schedule.create({
    data: {
      userId,
      name: 'Default Schedule',
      isDefault: true,
      timezone,
      rules: {
        create: DEFAULT_RULES.map((r) => ({
          weekday: r.weekday,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
        })),
      },
    },
    include: { rules: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] } },
  });

  return schedule;
}

// ──────────────────────────────────────────────────
// Create a new (non-default) schedule
// ──────────────────────────────────────────────────

export async function createSchedule(
  userId: string,
  name: string,
  timezone: string,
): Promise<Schedule & { rules: ScheduleRule[] }> {
  return db.schedule.create({
    data: { userId, name, isDefault: false, timezone },
    include: { rules: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] } },
  });
}

// ──────────────────────────────────────────────────
// Replace all rules atomically
// ──────────────────────────────────────────────────

export async function updateScheduleRules(
  scheduleId: string,
  rules: RuleInput[],
): Promise<ScheduleRule[]> {
  const parsed = weeklyRulesSchema.safeParse(rules);
  if (!parsed.success) {
    throw new Error(
      `Invalid rules: ${parsed.error.errors.map((e) => e.message).join('; ')}`,
    );
  }

  const updated = await db.$transaction(async (tx) => {
    await tx.scheduleRule.deleteMany({ where: { scheduleId } });
    if (parsed.data.length === 0) return [];
    await tx.scheduleRule.createMany({
      data: parsed.data.map((r) => ({
        scheduleId,
        weekday: r.weekday,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
      })),
    });
    return tx.scheduleRule.findMany({
      where: { scheduleId },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
  });

  return updated;
}

// ──────────────────────────────────────────────────
// Delete a schedule (refuses default)
// ──────────────────────────────────────────────────

export async function deleteSchedule(scheduleId: string): Promise<void> {
  const schedule = await db.schedule.findUniqueOrThrow({ where: { id: scheduleId } });

  if (schedule.isDefault) {
    throw new Error('Cannot delete the default schedule');
  }

  // Phase 5 will add a check for EventType references here.
  await db.schedule.delete({ where: { id: scheduleId } });
}

// ──────────────────────────────────────────────────
// List all schedules for a user
// ──────────────────────────────────────────────────

export async function listSchedules(userId: string): Promise<
  (Schedule & { rules: ScheduleRule[]; _count: { overrides: number } })[]
> {
  return db.schedule.findMany({
    where: { userId },
    include: {
      rules: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
      _count: { select: { overrides: true } },
    },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
}
