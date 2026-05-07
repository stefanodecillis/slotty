import type { NextRequest } from 'next/server';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function publicHost(): string {
  try {
    return new URL(env.SLOTTY_PUBLIC_URL).host.toLowerCase();
  } catch {
    return '';
  }
}

function originHost(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Origin/Referer-based CSRF check. Returns `true` for safe methods unconditionally;
 * for state-changing methods, the request is accepted only if the Origin (or Referer
 * if Origin is absent) host matches `SLOTTY_PUBLIC_URL`. When `SLOTTY_TRUST_PROXY`
 * is enabled, we additionally accept requests whose `X-Forwarded-Host` header
 * matches the public-URL host — this lets a reverse proxy terminate TLS.
 */
export function validateOrigin(request: Request | NextRequest): boolean {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return true;

  const expected = publicHost();
  if (!expected) return false;

  const origin = request.headers.get('origin');
  const fromOrigin = originHost(origin);
  if (fromOrigin && fromOrigin === expected) return true;

  if (!origin) {
    const fromReferer = originHost(request.headers.get('referer'));
    if (fromReferer && fromReferer === expected) return true;
  }

  if (env.SLOTTY_TRUST_PROXY) {
    const forwardedHost = request.headers.get('x-forwarded-host');
    if (forwardedHost && forwardedHost.toLowerCase() === expected) return true;
  }

  return false;
}

/**
 * Wrap a Next.js route handler so any non-safe method without a matching origin
 * receives a 403 before the handler runs. Use on every state-changing admin
 * route. Server actions that don't go through this should call
 * `validateOrigin` themselves.
 */
export function csrf<TArgs extends unknown[]>(
  handler: (req: NextRequest, ...rest: TArgs) => Promise<Response> | Response,
): (req: NextRequest, ...rest: TArgs) => Promise<Response> {
  return async (req, ...rest) => {
    if (!validateOrigin(req)) {
      logger.warn(
        {
          event: 'csrf.rejected',
          method: req.method,
          origin: req.headers.get('origin'),
          referer: req.headers.get('referer'),
        },
        'csrf rejected request',
      );
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    return handler(req, ...rest);
  };
}
