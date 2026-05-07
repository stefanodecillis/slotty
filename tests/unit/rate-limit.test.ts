import { describe, it, expect, beforeEach } from 'bun:test';

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.loginAttempt.deleteMany({});
});

describe('login rate limiter', () => {
  it('allows the first 10 failed attempts', async () => {
    const { recordLoginAttempt, checkLoginRateLimit } = await import('@/lib/auth/rate-limit');
    const ip = '203.0.113.1';
    for (let i = 0; i < 10; i++) {
      const decision = await checkLoginRateLimit(ip);
      expect(decision.allowed).toBe(true);
      await recordLoginAttempt(ip, false);
    }
    // 10 failures recorded — the next attempt should be locked out.
    const after10 = await checkLoginRateLimit(ip);
    expect(after10.allowed).toBe(false);
    if (!after10.allowed) {
      expect(after10.retryAfterSec).toBeGreaterThan(0);
      // 60s base, allow 1s ceil headroom.
      expect(after10.retryAfterSec).toBeLessThanOrEqual(61);
    }
  });

  it('doubles the lockout window with each failure past the threshold', async () => {
    const { recordLoginAttempt, checkLoginRateLimit } = await import('@/lib/auth/rate-limit');
    const ip = '203.0.113.2';
    for (let i = 0; i < 10; i++) await recordLoginAttempt(ip, false);

    const a = await checkLoginRateLimit(ip);
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.retryAfterSec).toBeLessThanOrEqual(61);

    await recordLoginAttempt(ip, false);
    const b = await checkLoginRateLimit(ip);
    expect(b.allowed).toBe(false);
    if (!b.allowed) {
      // 11th failure -> 2 lockouts, window = 60 * 2^1 = 120s
      expect(b.retryAfterSec).toBeGreaterThan(60);
      expect(b.retryAfterSec).toBeLessThanOrEqual(121);
    }

    await recordLoginAttempt(ip, false);
    const c = await checkLoginRateLimit(ip);
    expect(c.allowed).toBe(false);
    if (!c.allowed) {
      // 12th failure -> 3 lockouts, window = 60 * 2^2 = 240s
      expect(c.retryAfterSec).toBeGreaterThan(120);
      expect(c.retryAfterSec).toBeLessThanOrEqual(241);
    }
  });

  it('clears state after a successful login', async () => {
    const { recordLoginAttempt, checkLoginRateLimit } = await import('@/lib/auth/rate-limit');
    const ip = '203.0.113.3';
    for (let i = 0; i < 10; i++) await recordLoginAttempt(ip, false);

    const before = await checkLoginRateLimit(ip);
    expect(before.allowed).toBe(false);

    await recordLoginAttempt(ip, true);
    const after = await checkLoginRateLimit(ip);
    expect(after.allowed).toBe(true);
  });

  it('isolates limits per IP', async () => {
    const { recordLoginAttempt, checkLoginRateLimit } = await import('@/lib/auth/rate-limit');
    for (let i = 0; i < 10; i++) await recordLoginAttempt('203.0.113.10', false);
    const blocked = await checkLoginRateLimit('203.0.113.10');
    const free = await checkLoginRateLimit('203.0.113.11');
    expect(blocked.allowed).toBe(false);
    expect(free.allowed).toBe(true);
  });
});
