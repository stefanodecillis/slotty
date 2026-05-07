import { env } from '@/lib/env';

/**
 * Resolve the originating client IP for rate-limit / audit purposes.
 *
 * `X-Forwarded-For` is only honored when `SLOTTY_TRUST_PROXY=true`. We take
 * the leftmost address since chained proxies append on the right. Falls back
 * to a sentinel string so the limiter still has something to key on.
 */
export function getClientIp(headers: Headers): string {
  if (env.SLOTTY_TRUST_PROXY) {
    const xff = headers.get('x-forwarded-for');
    if (xff) {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
    const realIp = headers.get('x-real-ip');
    if (realIp) return realIp.trim();
  }
  return 'unknown';
}
