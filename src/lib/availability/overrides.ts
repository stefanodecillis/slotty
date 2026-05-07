import { DateTime } from 'luxon';
import { db } from '@/lib/db';
import type { DateOverride } from '@prisma/client';
import type { DateOverrideInput } from './validators';

/**
 * Normalise a JS Date to midnight UTC for the calendar date it represents
 * when viewed in UTC. Always use this before storing DateOverride.date.
 */
function toMidnightUtc(date: Date): Date {
  const dt = DateTime.fromJSDate(date, { zone: 'utc' }).startOf('day');
  return dt.toJSDate();
}

// ──────────────────────────────────────────────────
// Upsert
// ──────────────────────────────────────────────────

export async function setDateOverride(
  scheduleId: string,
  date: Date,
  override: DateOverrideInput,
): Promise<DateOverride> {
  const normalised = toMidnightUtc(date);

  return db.dateOverride.upsert({
    where: { scheduleId_date: { scheduleId, date: normalised } },
    create: {
      scheduleId,
      date: normalised,
      isBlocked: override.isBlocked,
      startMinute: override.startMinute ?? null,
      endMinute: override.endMinute ?? null,
      label: override.label ?? null,
      source: 'manual',
    },
    update: {
      isBlocked: override.isBlocked,
      startMinute: override.startMinute ?? null,
      endMinute: override.endMinute ?? null,
      label: override.label ?? null,
      // Never change source to 'manual' if it was 'holiday-import' —
      // but for user-initiated overrides we always set manual.
      source: 'manual',
    },
  });
}

// ──────────────────────────────────────────────────
// Remove
// ──────────────────────────────────────────────────

export async function removeDateOverride(scheduleId: string, date: Date): Promise<void> {
  const normalised = toMidnightUtc(date);
  await db.dateOverride.deleteMany({
    where: { scheduleId, date: normalised },
  });
}

// ──────────────────────────────────────────────────
// List (for admin UI range queries)
// ──────────────────────────────────────────────────

export async function listDateOverrides(
  scheduleId: string,
  from: Date,
  to: Date,
): Promise<DateOverride[]> {
  return db.dateOverride.findMany({
    where: {
      scheduleId,
      date: {
        gte: toMidnightUtc(from),
        lte: toMidnightUtc(to),
      },
    },
    orderBy: { date: 'asc' },
  });
}
