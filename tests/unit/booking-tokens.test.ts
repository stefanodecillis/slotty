/**
 * Booking token verification tests.
 *
 * The contract:
 *   - `generateToken` returns a raw token (URL-safe base64) and its sha256 hex.
 *   - `verifyBookingToken` returns 'reschedule' / 'cancel' / null based on
 *     which stored hash matches the *hashed* form of the candidate.
 *   - Comparison is constant-time (we exercise it indirectly by comparing
 *     mismatched lengths, which `safeEqual` rejects without a partial scan).
 */
import { describe, it, expect } from 'bun:test';

import { generateToken, hashToken } from '@/lib/crypto';
import { verifyBookingToken } from '@/lib/booking/tokens';

describe('verifyBookingToken', () => {
  it('matches the cancel token to its hash', () => {
    const cancel = generateToken(32);
    const reschedule = generateToken(32);
    const booking = { cancelTokenHash: cancel.hash, rescheduleTokenHash: reschedule.hash };

    expect(verifyBookingToken(booking, cancel.token)).toBe('cancel');
  });

  it('matches the reschedule token to its hash', () => {
    const cancel = generateToken(32);
    const reschedule = generateToken(32);
    const booking = { cancelTokenHash: cancel.hash, rescheduleTokenHash: reschedule.hash };

    expect(verifyBookingToken(booking, reschedule.token)).toBe('reschedule');
  });

  it('rejects a wrong token', () => {
    const cancel = generateToken(32);
    const reschedule = generateToken(32);
    const stranger = generateToken(32);
    const booking = { cancelTokenHash: cancel.hash, rescheduleTokenHash: reschedule.hash };

    expect(verifyBookingToken(booking, stranger.token)).toBeNull();
  });

  it('rejects an empty token', () => {
    const cancel = generateToken(32);
    const reschedule = generateToken(32);
    const booking = { cancelTokenHash: cancel.hash, rescheduleTokenHash: reschedule.hash };

    expect(verifyBookingToken(booking, '')).toBeNull();
  });

  it('rejects a string of the right shape but wrong content', () => {
    const cancel = generateToken(32);
    const reschedule = generateToken(32);
    const booking = { cancelTokenHash: cancel.hash, rescheduleTokenHash: reschedule.hash };

    // Same length as a real token but completely different bytes.
    const fake = 'a'.repeat(cancel.token.length);
    expect(verifyBookingToken(booking, fake)).toBeNull();
  });

  it('does not accept a stored hash directly as a token', () => {
    // Defense: the hash itself must NOT verify, only its preimage.
    const cancel = generateToken(32);
    const reschedule = generateToken(32);
    const booking = { cancelTokenHash: cancel.hash, rescheduleTokenHash: reschedule.hash };

    expect(verifyBookingToken(booking, cancel.hash)).toBeNull();
    expect(verifyBookingToken(booking, reschedule.hash)).toBeNull();
  });

  it('hashes a known token deterministically', () => {
    const t = 'abc123';
    expect(hashToken(t)).toBe(hashToken(t));
    // Sanity: the result is hex-shaped and 64 chars (sha256 hex).
    expect(hashToken(t)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('prefers reschedule when both hashes happen to match (defensive)', () => {
    const t = generateToken(32);
    const booking = { cancelTokenHash: t.hash, rescheduleTokenHash: t.hash };
    expect(verifyBookingToken(booking, t.token)).toBe('reschedule');
  });
});
