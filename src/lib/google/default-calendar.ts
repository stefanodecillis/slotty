/**
 * Resolve the calendar new bookings land on for a connected account.
 *
 * The admin only picks the Google account; bookings always go to that
 * account's primary calendar (Google's "default" calendar). The primary flag
 * is mirrored from Google on every calendar-list sync, so it's the one stable
 * pointer we have.
 */
import { db } from '@/lib/db';

export class DefaultCalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefaultCalendarError';
  }
}

export async function resolveDefaultCalendarId(connectedAccountId: string): Promise<string> {
  const account = await db.connectedAccount.findUnique({
    where: { id: connectedAccountId },
    select: { id: true },
  });
  if (!account) {
    throw new DefaultCalendarError('Destination account not found');
  }
  const calendar = await db.calendar.findFirst({
    where: { connectedAccountId, isPrimary: true },
    select: { id: true },
  });
  if (!calendar) {
    throw new DefaultCalendarError(
      'This Google account has no primary calendar synced yet. Resync it from the Calendars page.',
    );
  }
  return calendar.id;
}
