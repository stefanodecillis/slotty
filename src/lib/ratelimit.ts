/**
 * Tiny in-memory token bucket for public-API rate limiting.
 *
 * One bucket per (scope, key) pair; we use it for `slots` (60 req/min/IP) and
 * Phase 7 will use it for booking attempts. State is process-local — for the
 * single-instance MVP that's fine; if we ever scale horizontally we'd swap
 * this for a Redis-backed limiter.
 *
 * Algorithm: classic leaky bucket. We refill `capacity / windowMs` tokens
 * per millisecond on each check, cap at `capacity`, then try to debit one
 * token. If the debit underflows we report the wait until the next token.
 */

interface Bucket {
  tokens: number;
  lastRefill: number; // ms
}

const stores = new Map<string, Map<string, Bucket>>();
let lastSweep = 0;

function getStore(scope: string): Map<string, Bucket> {
  let s = stores.get(scope);
  if (!s) {
    s = new Map();
    stores.set(scope, s);
  }
  return s;
}

export interface RateLimitConfig {
  capacity: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
}

export function consume(
  scope: string,
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  const store = getStore(scope);
  const ratePerMs = config.capacity / config.windowMs;

  let bucket = store.get(key);
  if (!bucket) {
    bucket = { tokens: config.capacity, lastRefill: now };
    store.set(key, bucket);
  }

  // Lazy refill.
  const elapsed = Math.max(0, now - bucket.lastRefill);
  bucket.tokens = Math.min(config.capacity, bucket.tokens + elapsed * ratePerMs);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    // Periodically prune empty buckets to bound memory.
    if (now - lastSweep > 60_000) {
      lastSweep = now;
      for (const [k, v] of store) {
        if (v.tokens >= config.capacity && now - v.lastRefill > config.windowMs * 4) {
          store.delete(k);
        }
      }
    }
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: 0,
      limit: config.capacity,
    };
  }

  const deficit = 1 - bucket.tokens;
  const retryAfterMs = Math.ceil(deficit / ratePerMs);
  return {
    allowed: false,
    remaining: 0,
    retryAfterMs,
    limit: config.capacity,
  };
}

/** Test helper: wipe all rate limiter state. */
export function _resetForTests(): void {
  stores.clear();
}
