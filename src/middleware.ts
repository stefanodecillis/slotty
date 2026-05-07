/**
 * Slotty security middleware.
 *
 * Runs on every request in the Edge runtime. Responsible for:
 *   - Defense-in-depth security headers (CSP, HSTS, frame-options, etc.)
 *   - Lightweight policy decisions that don't need DB access
 *
 * Per-route rate limiting is intentionally NOT done here — see the README's
 * "Security model" section. Edge middleware can't share state with our
 * Node-side token bucket (`src/lib/ratelimit.ts`), so each Node API route
 * does its own `consume()` call. Doing it twice would just double-count.
 *
 * Header policy:
 *   X-Frame-Options:           DENY for /admin/*, SAMEORIGIN elsewhere
 *   X-Content-Type-Options:    nosniff (everywhere)
 *   Referrer-Policy:           strict-origin-when-cross-origin
 *   Permissions-Policy:        camera=(), microphone=(), geolocation=()
 *   Strict-Transport-Security: only when HTTPS is detected (avoid breaking
 *                              local dev where Slotty is reached via http://)
 *   Content-Security-Policy:   tuned for the Material You + Roboto fonts +
 *                              optional Cloudflare Turnstile widget.
 *
 * Edge runtime constraint: NO node:* imports. We can't import `@/lib/env`
 * because the proxy reads `process.env` at request time and pulls in
 * Node-only crypto. Instead we read the few env vars we need directly off
 * `process.env` — this works in both runtimes.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const STATIC_PATH_PREFIXES = [
  '/_next/',
  '/avatars/',
  '/favicon',
  '/icons/',
  '/images/',
];

function isStaticAsset(pathname: string): boolean {
  for (const p of STATIC_PATH_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  return false;
}

function trustProxy(): boolean {
  const v = process.env.SLOTTY_TRUST_PROXY;
  if (v === undefined) return true; // matches env.ts default
  return ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
}

/** True when the request *originated* over TLS (after reverse-proxy). */
function isHttps(req: NextRequest): boolean {
  // Next.js sets req.nextUrl.protocol from the request URL; behind a TLS-
  // terminating proxy this is "http:" since the proxy talks to us in clear.
  if (req.nextUrl.protocol === 'https:') return true;
  if (trustProxy()) {
    const proto = req.headers.get('x-forwarded-proto');
    if (proto && proto.split(',')[0]?.trim().toLowerCase() === 'https') return true;
  }
  return false;
}

function turnstileEnabled(): boolean {
  return Boolean(
    process.env.SLOTTY_TURNSTILE_SITE_KEY && process.env.SLOTTY_TURNSTILE_SECRET,
  );
}

function buildCsp(opts: { isAdmin: boolean }): string {
  const turnstile = turnstileEnabled();

  // Next.js Fast Refresh in development executes its hot-reload runtime via
  // `eval()`, so we relax script-src to allow it in dev only. Production
  // builds never need this and keep the stricter policy.
  const scriptSrc =
    process.env.NODE_ENV === 'development'
      ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
      : ["'self'", "'unsafe-inline'"];
  const frameSrc = [];
  const connectSrc = ["'self'"];

  if (turnstile) {
    scriptSrc.push('https://challenges.cloudflare.com');
    frameSrc.push('https://challenges.cloudflare.com');
    connectSrc.push('https://challenges.cloudflare.com');
  }

  // The public profile / booking pages embed Google avatar URLs (lh3) and
  // Google Fonts. Admin pages use the same fonts (Roboto Flex).
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'script-src': scriptSrc,
    'connect-src': connectSrc,
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };

  if (frameSrc.length > 0) {
    directives['frame-src'] = frameSrc;
  }

  // Admin gets the same hardening — `frame-ancestors 'none'` is the
  // important one and it's already set above. Reserved for future
  // tightening (e.g., dropping 'unsafe-inline' once we eliminate the
  // ThemeScript inline payload).
  void opts;

  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

function applySecurityHeaders(req: NextRequest, res: NextResponse): NextResponse {
  const pathname = req.nextUrl.pathname;
  const isAdminPath =
    pathname.startsWith('/admin') || pathname.startsWith('/api/admin');

  // Frame-options: deny clickjacking on admin entirely; everywhere else,
  // SAMEORIGIN is enough since CSP `frame-ancestors 'none'` is the modern
  // equivalent and we set that too.
  res.headers.set('X-Frame-Options', isAdminPath ? 'DENY' : 'SAMEORIGIN');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  );

  if (isHttps(req)) {
    res.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains',
    );
  }

  // Don't override CSP if downstream (e.g., a route handler) already set one.
  if (!res.headers.has('Content-Security-Policy')) {
    res.headers.set('Content-Security-Policy', buildCsp({ isAdmin: isAdminPath }));
  }

  return res;
}

export function middleware(req: NextRequest): NextResponse {
  // Skip Next-internal static assets — they don't need CSP and Next will
  // serve them with their own immutable cache headers.
  if (isStaticAsset(req.nextUrl.pathname)) {
    return NextResponse.next();
  }
  const res = NextResponse.next({
    request: {
      headers: new Headers({
        ...Object.fromEntries(req.headers.entries()),
        'x-pathname': req.nextUrl.pathname,
      }),
    },
  });
  return applySecurityHeaders(req, res);
}

export const config = {
  // Run on every request *except* Next-internal asset paths and the
  // public health check (which should be as fast as possible for orchestrators).
  matcher: [
    '/((?!_next/static|_next/image|api/health|favicon.ico|avatars).*)',
  ],
};

// Exported for unit tests.
export const __testing = { applySecurityHeaders, buildCsp, isHttps };
