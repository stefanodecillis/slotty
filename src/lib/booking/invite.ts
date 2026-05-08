/**
 * Helpers for resolving and atomically claiming one-time booking invites.
 *
 * The invite link surface area is small but has two correctness rules:
 *  - The raw token never leaves the database in any form. Lookup is by
 *    sha256(token) — same pattern used for cancel/reschedule tokens.
 *  - Claiming an invite (transitioning usedAt from NULL → now()) must be
 *    atomic with creating the Booking row that consumes it. The booking
 *    transaction calls `claimInviteAtomically` and the surrounding tx
 *    rolls back if no row was updated, which is what protects us from
 *    two concurrent bookers racing on the same token.
 */
import type { Prisma, BookingInvite, EventType, EventTypeQuestion } from '@prisma/client';

import { db } from '@/lib/db';
import { hashToken } from '@/lib/crypto';
import { BookingError } from './create';

export type InviteResolutionStatus = 'ok' | 'not_found' | 'used' | 'expired' | 'revoked';

export interface ResolvedInvite {
  status: InviteResolutionStatus;
  invite: BookingInvite | null;
  eventType: (EventType & { questions: EventTypeQuestion[] }) | null;
}

/**
 * Hash + look up a raw token. Returns the invite plus the joined event type
 * (with questions) for the happy path, or a status code identifying why the
 * token isn't usable.
 */
export async function resolveInviteByRawToken(rawToken: string): Promise<ResolvedInvite> {
  if (!rawToken || typeof rawToken !== 'string') {
    return { status: 'not_found', invite: null, eventType: null };
  }
  const tokenHash = hashToken(rawToken);
  const invite = await db.bookingInvite.findUnique({
    where: { tokenHash },
    include: {
      eventType: { include: { questions: { orderBy: { position: 'asc' } } } },
    },
  });
  if (!invite) return { status: 'not_found', invite: null, eventType: null };

  // Strip the joined event type from the invite shape so the returned shape
  // is stable regardless of the lookup path. The .eventType isn't actually
  // present on plain BookingInvite — Prisma's typing here would otherwise
  // leak through.
  const { eventType, ...inviteCore } = invite;

  if (invite.revokedAt) return { status: 'revoked', invite: inviteCore, eventType };
  if (invite.usedAt) return { status: 'used', invite: inviteCore, eventType };
  if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
    return { status: 'expired', invite: inviteCore, eventType };
  }
  return { status: 'ok', invite: inviteCore, eventType };
}

/**
 * Atomically claim an invite for a booking. Must be called inside a
 * `db.$transaction(...)` callback so the booking row and the claim share a
 * single commit boundary.
 *
 * The `where` predicate matches only unused, unrevoked invites — Prisma
 * compiles it to a single UPDATE ... WHERE statement which SQLite executes
 * under a row lock, so a concurrent claim either updates this row first
 * (making our updateMany return count=0 here) or arrives after we commit.
 */
export async function claimInviteAtomically(
  tx: Prisma.TransactionClient,
  inviteId: string,
  bookingId: string,
): Promise<void> {
  const result = await tx.bookingInvite.updateMany({
    where: { id: inviteId, usedAt: null, revokedAt: null },
    data: { usedAt: new Date(), usedByBookingId: bookingId },
  });
  if (result.count !== 1) {
    throw new BookingError(
      'This invite link is no longer available.',
      'INVITE_UNAVAILABLE',
      410,
    );
  }
}
