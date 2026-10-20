/**
 * Slotty security middleware.
 *
 * Runs on every request in the Edge runtime. Responsible for:
 *   - Defense-in-depth security headers (CSP, HSTS, frame-options, etc.)
 *   - Lightweight policy decisions that don't need DB access
 *   - "One link for humans and AI assistants": a GET for a booking page
 *     (`/<slug>`, `/i/<token>`) that explicitly prefers JSON or Markdown
 *     over HTML is rewritten to that link's agent descriptor
 *     (`/api/agent/…`). Browsers and Next's own router requests never are.
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

import { agentFormatFromAccept, agentPathFor, isFrameworkRequest } from '@/lib/agent/negotiate';

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
    // `blob:` is required so the admin brand-logo cropper can preview the
    // file the user just picked (URL.createObjectURL produces a blob: URL).
    'img-src': ["'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'script-src': scriptSrc,
    'connect-src': connectSrc,
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    // form-action intentionally omitted: CSRF protection comes from
    // `validateOrigin()` (src/lib/auth/csrf.ts), which checks Origin/Referer
    // against SLOTTY_PUBLIC_URL on every state-changing request. The CSP
    // directive was triggering false-positive blocks on plain-http homeserver
    // setups (e.g., http://truenas:3210) where browsers' HTTPS upgrade or
    // single-label-host quirks prevented `'self'` from matching same-origin
    // submissions. frame-ancestors 'none' still defends against clickjacking.
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
  const requestHeaders = new Headers({
    ...Object.fromEntries(req.headers.entries()),
    'x-pathname': req.nextUrl.pathname,
  });

  const agentRewrite = agentRewriteUrl(req);
  if (agentRewrite) {
    const res = NextResponse.rewrite(agentRewrite, { request: { headers: requestHeaders } });
    appendVary(res, 'Accept');
    return applySecurityHeaders(req, res);
  }

  // The HTML side of a negotiated booking page can't carry `Vary: Accept`
  // (Next sets the page's Vary itself), but those pages are `no-store`, so
  // no cache can hand the HTML to an agent or the descriptor to a browser.
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  return applySecurityHeaders(req, res);
}

/** Where to serve an agent's request for a booking page, or null to serve the page. */
function agentRewriteUrl(req: NextRequest): URL | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const target = agentPathFor(req.nextUrl.pathname);
  if (!target || isFrameworkRequest(req.headers)) return null;
  const format = agentFormatFromAccept(req.headers.get('accept'));
  if (!format) return null;
  const url = req.nextUrl.clone();
  url.pathname = target;
  if (!url.searchParams.has('format')) url.searchParams.set('format', format);
  return url;
}

function appendVary(res: NextResponse, value: string): void {
  const current = res.headers.get('Vary');
  const parts = current ? current.split(',').map((v) => v.trim().toLowerCase()) : [];
  if (!parts.includes(value.toLowerCase())) {
    res.headers.set('Vary', current ? `${current}, ${value}` : value);
  }
}

export const config = {
  // Run on every request *except* Next-internal asset paths and the
  // public health check (which should be as fast as possible for orchestrators).
  matcher: [
    '/((?!_next/static|_next/image|api/health|favicon.ico|avatars).*)',
  ],
};

// Exported for unit tests.
export const __testing = { applySecurityHeaders, buildCsp, isHttps, agentRewriteUrl };
