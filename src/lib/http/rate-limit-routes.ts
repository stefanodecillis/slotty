/**
 * Per-route rate limit wrapper for Next.js public API handlers.
 *
 * Why this lives next to the routes instead of in `middleware.ts`:
 * Next.js middleware runs in the Edge runtime where we can't share state
 * with the in-memory token bucket used by Node-side handlers. Rather than
 * stand up a second limiter at the Edge, every public route consumes from
 * the same Node-side `consume()` and we just centralize the boilerplate.
 *
 * Usage:
 *   export const POST = withPublicRateLimit(
 *     { scope: 'public-bookings', capacity: 10, windowMs: 60_000 },
 *     async (req) => {
 *       // …handler body…
 *     },
 *   );
 *
 * The wrapper:
 *   1. Resolves the client IP via `getClientIp` (honoring SLOTTY_TRUST_PROXY).
 *   2. Calls `consume()` against the configured bucket.
 *   3. Returns 429 with `Retry-After` + `X-RateLimit-*` headers on excess.
 *   4. Otherwise invokes the inner handler and stamps the same rate-limit
 *      headers onto the successful response.
 *
 * Status codes:
 *   - 429 with body `{ error: "Rate limit exceeded" }`.
 *
 * Note: This wrapper is intentionally not used to *replace* the existing
 * inline `consume()` calls in already-shipped routes — those routes have
 * route-specific error messages we want to preserve. This wrapper exists for
 * (a) new routes added in Phase 10 and (b) tests, which need a known-shape
 * handler to exercise the limit boundary.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { consume, type RateLimitConfig } from '@/lib/ratelimit';
import { getClientIp } from '@/lib/http/client-ip';

export interface PublicRateLimitOptions extends RateLimitConfig {
  /** Bucket scope key — keep distinct per logical resource, e.g. "public-bookings". */
  scope: string;
  /** Optional message used in the 429 response body. */
  message?: string;
}

export type PublicRouteHandler<TArgs extends unknown[]> = (
  req: NextRequest,
  ...rest: TArgs
) => Promise<Response> | Response;

export function withPublicRateLimit<TArgs extends unknown[]>(
  opts: PublicRateLimitOptions,
  handler: PublicRouteHandler<TArgs>,
): PublicRouteHandler<TArgs> {
  const { scope, capacity, windowMs, message = 'Rate limit exceeded' } = opts;
  return async (req, ...rest) => {
    const ip = getClientIp(req.headers);
    const decision = consume(scope, ip, { capacity, windowMs });
    if (!decision.allowed) {
      return NextResponse.json(
        { error: message },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)),
            'X-RateLimit-Limit': String(decision.limit),
            'X-RateLimit-Remaining': '0',
          },
        },
      );
    }
    const res = await handler(req, ...rest);
    // Stamp limit headers if the inner handler returned a fresh response.
    if (res.headers && !res.headers.has('X-RateLimit-Limit')) {
      try {
        res.headers.set('X-RateLimit-Limit', String(decision.limit));
        res.headers.set('X-RateLimit-Remaining', String(decision.remaining));
      } catch {
        // Some Response variants are immutable — ignore.
      }
    }
    return res;
  };
}
