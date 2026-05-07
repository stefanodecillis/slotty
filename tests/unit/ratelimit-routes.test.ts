/**
 * Tests for the public-route rate limit wrapper at
 * `src/lib/http/rate-limit-routes.ts`.
 *
 * Validates that the wrapper:
 *   - Allows up to `capacity` requests within `windowMs`.
 *   - Returns 429 with a sane Retry-After header on the first overflow.
 *   - Stamps `X-RateLimit-*` headers on success.
 *   - Distinguishes between IPs (one IP being limited doesn't affect another).
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

import { withPublicRateLimit } from '@/lib/http/rate-limit-routes';
import { _resetForTests } from '@/lib/ratelimit';

beforeEach(() => {
  _resetForTests();
});

function makeReq(ip: string, path = 'http://localhost/api/public/bookings'): NextRequest {
  return new NextRequest(
    new Request(path, {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
    }),
  );
}

describe('withPublicRateLimit', () => {
  it('allows up to capacity then 429s with Retry-After', async () => {
    const handler = withPublicRateLimit(
      { scope: 'test-bookings', capacity: 10, windowMs: 60_000 },
      async () => NextResponse.json({ ok: true }),
    );

    for (let i = 0; i < 10; i++) {
      const res = await handler(makeReq('203.0.113.5'));
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    }

    const blocked = await handler(makeReq('203.0.113.5'));
    expect(blocked.status).toBe(429);
    const retry = blocked.headers.get('Retry-After');
    expect(retry).toBeTruthy();
    expect(Number(retry)).toBeGreaterThan(0);
    const body = await blocked.json();
    expect(body).toEqual({ error: 'Rate limit exceeded' });
  });

  it('isolates buckets per IP', async () => {
    const handler = withPublicRateLimit(
      { scope: 'test-iso', capacity: 3, windowMs: 60_000 },
      async () => NextResponse.json({ ok: true }),
    );

    for (let i = 0; i < 3; i++) {
      const res = await handler(makeReq('203.0.113.10'));
      expect(res.status).toBe(200);
    }
    // First IP is now exhausted.
    const blocked = await handler(makeReq('203.0.113.10'));
    expect(blocked.status).toBe(429);

    // Second IP still has full quota.
    const fresh = await handler(makeReq('203.0.113.11'));
    expect(fresh.status).toBe(200);
  });

  it('respects a custom message in the 429 body', async () => {
    const handler = withPublicRateLimit(
      {
        scope: 'test-msg',
        capacity: 1,
        windowMs: 60_000,
        message: 'Slow down, partner.',
      },
      async () => NextResponse.json({ ok: true }),
    );
    await handler(makeReq('203.0.113.20'));
    const blocked = await handler(makeReq('203.0.113.20'));
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body).toEqual({ error: 'Slow down, partner.' });
  });
});
