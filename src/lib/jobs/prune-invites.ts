/**
 * Daily retention sweep for BookingInvite + orphaned one-time EventTypes.
 *
 * Two-stage delete:
 *   1. Delete invites whose terminal status (used / revoked / expired-unused)
 *      is older than RETENTION_DAYS.
 *   2. Delete any `isOneTime` EventType that no longer has any invite.
 *      The EventType's bookings cascade-delete with it — that's intentional
 *      since one-time event types are ephemeral and their booking is already
 *      old enough to fall inside the retention window.
 *
 * Registered as a recurring job (`prune_booking_invites`, every 24h) in
 * `src/lib/jobs/scheduler.ts`. Safe to run idempotently — repeated runs are
 * no-ops once nothing matches.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const RETENTION_DAYS = 90;

export async function pruneOldBookingInvites(
  now: Date = new Date(),
): Promise<{ deletedInvites: number; deletedEventTypes: number }> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const deletedInvites = await db.bookingInvite.deleteMany({
    where: {
      OR: [
        // Consumed long ago.
        { usedAt: { lte: cutoff } },
        // Explicitly revoked long ago.
        { revokedAt: { lte: cutoff } },
        // Expired unused long ago.
        {
          AND: [
            { usedAt: null },
            { revokedAt: null },
            { expiresAt: { lte: cutoff } },
          ],
        },
      ],
    },
  });

  // Sweep one-time EventTypes that no longer have any invites — they're
  // unbookable (inviteOnly + no invite) and just clutter the table.
  const orphans = await db.eventType.findMany({
    where: { isOneTime: true, invites: { none: {} } },
    select: { id: true },
  });
  let deletedEventTypes = 0;
  if (orphans.length > 0) {
    const result = await db.eventType.deleteMany({
      where: { id: { in: orphans.map((o) => o.id) } },
    });
    deletedEventTypes = result.count;
  }

  logger.info(
    {
      event: 'invites.pruned',
      deletedInvites: deletedInvites.count,
      deletedEventTypes,
      cutoff: cutoff.toISOString(),
    },
    'pruned old booking invites and orphan one-time event types',
  );

  return { deletedInvites: deletedInvites.count, deletedEventTypes };
}
