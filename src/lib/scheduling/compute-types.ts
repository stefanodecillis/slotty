/**
 * Public types for slot computation. Kept in a separate file so the cache
 * module doesn't pull in the Prisma dependencies of `compute.ts`.
 */

export interface SlotEntry {
  /** ISO 8601 UTC instant for slot start, e.g. `2026-05-08T07:00:00.000Z`. */
  startUtc: string;
  /** ISO 8601 UTC instant for slot end (start + duration). */
  endUtc: string;
  /** Wall-clock label in the booker's tz, e.g. `09:00`. */
  startInBookerTz: string;
}

export interface SlotDay {
  /** YYYY-MM-DD in the booker's tz. */
  date: string;
  slots: SlotEntry[];
}

export interface SlotResult {
  days: SlotDay[];
  bookerTz: string;
  eventTypeId: string;
}
