/**
 * Helpers shared between Playwright spec files. We open a fresh
 * PrismaClient per test (the in-process global one would fight the
 * dev/prod server's client over the SQLite file under workers > 1, but
 * we run with workers: 1 and a journaling-friendly config).
 */
import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';

import { E2E_CONFIG } from '../../playwright.config';

export function prismaForE2e(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: E2E_CONFIG.databaseUrl } },
  });
}

/**
 * Compute a Tuesday at 10:00 UTC at least one full week in the future. Used by
 * the booking spec — picking a fixed weekday avoids weekend / next-day quirks.
 */
export function nextTuesdayAtTen(): Date {
  let dt = DateTime.utc().plus({ days: 7 }).startOf('day').set({ hour: 10 });
  while (dt.weekday !== 2) {
    dt = dt.plus({ days: 1 });
  }
  return dt.toJSDate();
}
