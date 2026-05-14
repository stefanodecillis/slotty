import type { EventType, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { eventTypeInputSchema } from './validator';
import type { EventTypeInput } from './validator';
import { logger } from '@/lib/logger';

// ─────────────────────────────────────────────────────────────
// Slug utilities
// ─────────────────────────────────────────────────────────────

/**
 * Convert a title into a URL-safe slug:
 * lowercase, replace non-alphanumeric runs with "-", trim leading/trailing
 * dashes, cap at 60 characters.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Find a unique slug for the given user. If `baseSlug` is taken,
 * appends -2, -3, … until a free one is found.
 */
export async function ensureUniqueSlug(
  userId: string,
  baseSlug: string,
  excludeId?: string,
): Promise<string> {
  let candidate = baseSlug;
  let attempt = 1;

  for (;;) {
    const existing = await db.eventType.findUnique({
      where: { slug: candidate },
      select: { id: true, userId: true },
    });

    if (!existing) return candidate; // free globally
    if (excludeId && existing.id === excludeId) return candidate; // same row

    attempt += 1;
    // Trim base to leave room for suffix
    const base = baseSlug.slice(0, 57);
    candidate = `${base}-${attempt}`;
  }
}

// ─────────────────────────────────────────────────────────────
// Destination validation
// ─────────────────────────────────────────────────────────────

async function validateDestination(
  userId: string,
  destinationAccountId: string,
  destinationCalendarId: string,
): Promise<void> {
  // Check that the account belongs to the user (via calendar ownership chain)
  // ConnectedAccount has no direct userId; ownership is inferred from the User
  // owning all data. For MVP single-user app this always passes, but we still
  // validate the calendar belongs to the account for correctness.
  const calendar = await db.calendar.findUnique({
    where: { id: destinationCalendarId },
    select: {
      id: true,
      connectedAccountId: true,
      isDestinationEligible: true,
    },
  });

  if (!calendar) {
    throw new ServiceError('Destination calendar not found', 'INVALID_DESTINATION');
  }
  if (calendar.connectedAccountId !== destinationAccountId) {
    throw new ServiceError(
      'Destination calendar does not belong to the specified account',
      'INVALID_DESTINATION',
    );
  }
  if (!calendar.isDestinationEligible) {
    throw new ServiceError(
      'Destination calendar is not enabled as a destination. Enable it in Calendars settings.',
      'INVALID_DESTINATION',
    );
  }
}

// Canonicalize a list of emails: trim, lowercase, drop blanks, dedupe.
// Order is preserved (first occurrence wins) so the admin sees their own
// ordering in the chip input after a round-trip.
function canonicalizeEmails(emails: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const e = raw.trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────

export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

// ─────────────────────────────────────────────────────────────
// CRUD operations
// ─────────────────────────────────────────────────────────────

export async function createEventType(userId: string, input: EventTypeInput): Promise<EventType> {
  await validateDestination(userId, input.destinationAccountId, input.destinationCalendarId);

  const slug = await ensureUniqueSlug(userId, input.slug);
  const passwordHash = input.password ? await hashPassword(input.password) : null;

  return db.eventType.create({
    data: {
      userId,
      title: input.title,
      slug,
      descriptionMd: input.descriptionMd ?? null,
      color: input.color,
      hidden: input.hidden,
      inviteOnly: input.inviteOnly,
      durationMinutes: input.durationMinutes,
      destinationAccountId: input.destinationAccountId,
      destinationCalendarId: input.destinationCalendarId,
      locationKind: input.locationKind,
      locationValue: input.locationValue ?? null,
      bufferBeforeMin: input.bufferBeforeMin,
      bufferAfterMin: input.bufferAfterMin,
      minNoticeMin: input.minNoticeMin,
      bookingWindowDays: input.bookingWindowDays,
      maxPerDay: input.maxPerDay ?? null,
      maxPerWeek: input.maxPerWeek ?? null,
      maxGuests: input.maxGuests,
      slotIntervalMin: input.slotIntervalMin,
      scheduleId: input.scheduleId ?? null,
      passwordHash,
      confirmationMd: input.confirmationMd ?? null,
      redirectUrl: input.redirectUrl ?? null,
      sendReminders: input.sendReminders,
      hiddenGuestsJson: JSON.stringify(canonicalizeEmails(input.hiddenGuests)),
      position: 0,
      archived: false,
      questions: {
        create: (input.questions ?? []).map((q, i) => ({
          label: q.label,
          helperText: q.helperText ?? null,
          kind: q.kind,
          required: q.required,
          optionsJson: q.optionsJson ?? null,
          position: q.position ?? i,
        })),
      },
    },
  });
}

export async function updateEventType(
  eventTypeId: string,
  userId: string,
  input: EventTypeInput,
): Promise<EventType> {
  const existing = await db.eventType.findUnique({
    where: { id: eventTypeId },
    select: { id: true, userId: true, passwordHash: true },
  });

  if (!existing || existing.userId !== userId) {
    throw new ServiceError('Event type not found', 'NOT_FOUND');
  }

  await validateDestination(userId, input.destinationAccountId, input.destinationCalendarId);

  const slug = await ensureUniqueSlug(userId, input.slug, eventTypeId);

  // If a new password was supplied, hash it; if null was explicitly supplied,
  // clear the hash; otherwise keep the existing hash.
  let passwordHash: string | null = existing.passwordHash;
  if (input.password) {
    passwordHash = await hashPassword(input.password);
  } else if (input.password === null) {
    passwordHash = null;
  }

  // Replace questions: delete all, then recreate
  return db.$transaction(async (tx) => {
    await tx.eventTypeQuestion.deleteMany({ where: { eventTypeId } });

    return tx.eventType.update({
      where: { id: eventTypeId },
      data: {
        title: input.title,
        slug,
        descriptionMd: input.descriptionMd ?? null,
        color: input.color,
        hidden: input.hidden,
        inviteOnly: input.inviteOnly,
        durationMinutes: input.durationMinutes,
        destinationAccountId: input.destinationAccountId,
        destinationCalendarId: input.destinationCalendarId,
        locationKind: input.locationKind,
        locationValue: input.locationValue ?? null,
        bufferBeforeMin: input.bufferBeforeMin,
        bufferAfterMin: input.bufferAfterMin,
        minNoticeMin: input.minNoticeMin,
        bookingWindowDays: input.bookingWindowDays,
        maxPerDay: input.maxPerDay ?? null,
        maxPerWeek: input.maxPerWeek ?? null,
        maxGuests: input.maxGuests,
        slotIntervalMin: input.slotIntervalMin,
        scheduleId: input.scheduleId ?? null,
        passwordHash,
        confirmationMd: input.confirmationMd ?? null,
        redirectUrl: input.redirectUrl ?? null,
        sendReminders: input.sendReminders,
        hiddenGuestsJson: JSON.stringify(canonicalizeEmails(input.hiddenGuests)),
        questions: {
          create: (input.questions ?? []).map((q, i) => ({
            label: q.label,
            helperText: q.helperText ?? null,
            kind: q.kind,
            required: q.required,
            optionsJson: q.optionsJson ?? null,
            position: q.position ?? i,
          })),
        },
      },
    });
  });
}

export async function duplicateEventType(eventTypeId: string, userId: string): Promise<EventType> {
  const source = await db.eventType.findUnique({
    where: { id: eventTypeId },
    include: { questions: { orderBy: { position: 'asc' } } },
  });

  if (!source || source.userId !== userId) {
    throw new ServiceError('Event type not found', 'NOT_FOUND');
  }

  const newTitle = `${source.title} (copy)`;
  const baseSlug = slugify(newTitle);
  const slug = await ensureUniqueSlug(userId, baseSlug);

  return db.eventType.create({
    data: {
      userId,
      title: newTitle,
      slug,
      descriptionMd: source.descriptionMd,
      color: source.color,
      hidden: source.hidden,
      inviteOnly: source.inviteOnly,
      durationMinutes: source.durationMinutes,
      destinationAccountId: source.destinationAccountId,
      destinationCalendarId: source.destinationCalendarId,
      locationKind: source.locationKind,
      locationValue: source.locationValue,
      bufferBeforeMin: source.bufferBeforeMin,
      bufferAfterMin: source.bufferAfterMin,
      minNoticeMin: source.minNoticeMin,
      bookingWindowDays: source.bookingWindowDays,
      maxPerDay: source.maxPerDay,
      maxPerWeek: source.maxPerWeek,
      maxGuests: source.maxGuests,
      slotIntervalMin: source.slotIntervalMin,
      scheduleId: source.scheduleId,
      passwordHash: null, // do not copy password
      confirmationMd: source.confirmationMd,
      redirectUrl: source.redirectUrl,
      sendReminders: source.sendReminders,
      hiddenGuestsJson: source.hiddenGuestsJson,
      position: 0,
      archived: false,
      questions: {
        create: source.questions.map((q) => ({
          label: q.label,
          helperText: q.helperText,
          kind: q.kind,
          required: q.required,
          optionsJson: q.optionsJson,
          position: q.position,
        })),
      },
    },
  });
}

export async function archiveEventType(eventTypeId: string, userId: string): Promise<void> {
  const existing = await db.eventType.findUnique({
    where: { id: eventTypeId },
    select: { id: true, userId: true },
  });
  if (!existing || existing.userId !== userId) {
    throw new ServiceError('Event type not found', 'NOT_FOUND');
  }
  await db.eventType.update({ where: { id: eventTypeId }, data: { archived: true } });
}

export async function unarchiveEventType(eventTypeId: string, userId: string): Promise<void> {
  const existing = await db.eventType.findUnique({
    where: { id: eventTypeId },
    select: { id: true, userId: true },
  });
  if (!existing || existing.userId !== userId) {
    throw new ServiceError('Event type not found', 'NOT_FOUND');
  }
  await db.eventType.update({ where: { id: eventTypeId }, data: { archived: false } });
}

export async function deleteEventType(eventTypeId: string, userId: string): Promise<void> {
  const existing = await db.eventType.findUnique({
    where: { id: eventTypeId },
    select: { id: true, userId: true },
  });
  if (!existing || existing.userId !== userId) {
    throw new ServiceError('Event type not found', 'NOT_FOUND');
  }
  // Bookings and their history (and any BookingInvites) cascade-delete with
  // the EventType — declared at the DB layer via the FK on `bookings`.
  await db.eventType.delete({ where: { id: eventTypeId } });
}

export async function reorderEventTypes(userId: string, ids: string[]): Promise<void> {
  // Verify all belong to this user
  const rows = await db.eventType.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true },
  });
  const ownedIds = new Set(rows.map((r) => r.id));
  for (const id of ids) {
    if (!ownedIds.has(id)) {
      throw new ServiceError(`Event type ${id} not found or not owned by user`, 'NOT_FOUND');
    }
  }

  await db.$transaction(
    ids.map((id, index) =>
      db.eventType.update({ where: { id }, data: { position: index } }),
    ),
  );
}

export async function setEventTypePassword(
  eventTypeId: string,
  userId: string,
  password: string | null,
): Promise<void> {
  const existing = await db.eventType.findUnique({
    where: { id: eventTypeId },
    select: { id: true, userId: true },
  });
  if (!existing || existing.userId !== userId) {
    throw new ServiceError('Event type not found', 'NOT_FOUND');
  }

  const passwordHash = password ? await hashPassword(password) : null;
  await db.eventType.update({ where: { id: eventTypeId }, data: { passwordHash } });
}

// ─────────────────────────────────────────────────────────────
// Disconnect cascade helper (called from calendars/disconnect)
// ─────────────────────────────────────────────────────────────

export async function archiveEventTypesForAccount(accountId: string): Promise<number> {
  const result = await db.eventType.updateMany({
    where: { destinationAccountId: accountId, archived: false },
    data: { archived: true },
  });

  if (result.count > 0) {
    logger.info(
      { event: 'eventtype.cascade_archive', accountId, count: result.count },
      'archived event types due to account disconnect',
    );
  }

  return result.count;
}

// ─────────────────────────────────────────────────────────────
// Hidden guests helpers
// ─────────────────────────────────────────────────────────────

// Parse a stored `hidden_guests_json` payload back into an email[]. Bad input
// (malformed JSON, wrong shape) collapses to [] — the column is admin-supplied
// and round-tripped through `canonicalizeEmails`, so a parse failure means
// a manual edit or a future schema drift; either way it's safer to skip the
// silent attendees than to crash the booking flow.
export function parseHiddenGuests(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// Re-export schema for convenience
// ─────────────────────────────────────────────────────────────
export { eventTypeInputSchema, ServiceError as EventTypeServiceError };
export type { EventTypeInput };
