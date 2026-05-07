import { db } from '@/lib/db';

/**
 * Per-IP login rate limiter backed by the `LoginAttempt` table.
 *
 * Policy:
 *   - Up to 10 failed attempts per rolling 15-minute window are allowed.
 *   - On the 11th and subsequent failures, the IP is locked out with an
 *     exponential backoff (1m, 2m, 4m, …) capped at 1 hour. The lockout is
 *     applied from the most recent failure.
 *   - A successful attempt clears the failure window (we mark it as a row,
 *     so checks that look only at recent failures stop seeing the streak).
 *
 * The limiter is best-effort: a sufficiently determined attacker can rotate
 * IPs. The argon2 work factor is the second line of defence.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const BASE_LOCKOUT_SEC = 60;
const MAX_LOCKOUT_SEC = 60 * 60;

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

export async function recordLoginAttempt(ip: string, success: boolean): Promise<void> {
  await db.loginAttempt.create({ data: { ip, success } });
}

export async function checkLoginRateLimit(ip: string): Promise<RateLimitDecision> {
  const now = Date.now();
  const since = new Date(now - WINDOW_MS);

  // Find the most recent successful attempt to clip the failure window.
  const lastSuccess = await db.loginAttempt.findFirst({
    where: { ip, success: true },
    orderBy: { attemptedAt: 'desc' },
    select: { attemptedAt: true },
  });

  const failureWindowStart =
    lastSuccess && lastSuccess.attemptedAt > since ? lastSuccess.attemptedAt : since;

  const failures = await db.loginAttempt.findMany({
    where: {
      ip,
      success: false,
      attemptedAt: { gt: failureWindowStart },
    },
    orderBy: { attemptedAt: 'desc' },
    select: { attemptedAt: true },
  });

  if (failures.length < MAX_FAILURES) {
    return { allowed: true };
  }

  const latest = failures[0];
  if (!latest) return { allowed: true };

  // Exponential backoff. With MAX_FAILURES=10:
  //   10 failures stored -> next attempt locked for 60s     (2^0)
  //   11 failures stored -> next attempt locked for 120s    (2^1)
  //   12 failures stored -> next attempt locked for 240s    (2^2)
  // Capped at MAX_LOCKOUT_SEC.
  const exponent = failures.length - MAX_FAILURES;
  const lockoutSec = Math.min(
    MAX_LOCKOUT_SEC,
    BASE_LOCKOUT_SEC * Math.pow(2, exponent),
  );

  const lockoutEndsAt = latest.attemptedAt.getTime() + lockoutSec * 1000;
  const remainingMs = lockoutEndsAt - now;

  if (remainingMs <= 0) {
    return { allowed: true };
  }
  return { allowed: false, retryAfterSec: Math.ceil(remainingMs / 1000) };
}
