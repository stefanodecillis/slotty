/**
 * Helpers for verifying booker self-service tokens against a Booking row.
 *
 * The raw cancel + reschedule tokens are returned to the booker exactly once
 * (in the create-booking response and a confirmation page URL). Only their
 * sha256 hashes live in the database. Comparison must be constant-time so we
 * don't leak which token matched via timing.
 */
import type { Booking } from '@prisma/client';

import { hashToken, safeEqual } from '@/lib/crypto';

export type BookingTokenKind = 'cancel' | 'reschedule';

/**
 * Hash the provided raw token and compare it (constant-time) against both
 * stored hashes. Returns which kind the token represents, or null if neither
 * matches.
 *
 * Reschedule tokens also imply cancel rights (a booker who can reschedule
 * obviously can also cancel). The kind we return is the *literal* match —
 * routes that accept either token should treat any non-null return as valid.
 */
export function verifyBookingToken(
  booking: Pick<Booking, 'cancelTokenHash' | 'rescheduleTokenHash'>,
  providedToken: string,
): BookingTokenKind | null {
  if (!providedToken || typeof providedToken !== 'string') return null;
  const candidate = hashToken(providedToken);
  if (safeEqual(candidate, booking.rescheduleTokenHash)) return 'reschedule';
  if (safeEqual(candidate, booking.cancelTokenHash)) return 'cancel';
  return null;
}
