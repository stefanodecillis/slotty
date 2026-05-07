/**
 * Unit tests for the security middleware.
 *
 * We exercise the exported `applySecurityHeaders` helper rather than the full
 * `middleware` function so we can construct deterministic NextRequest /
 * NextResponse pairs without booting the Next runtime.
 */
import { describe, it, expect } from 'bun:test';

import { __testing } from '@/middleware';
import { NextRequest, NextResponse } from 'next/server';

const { applySecurityHeaders, buildCsp, isHttps } = __testing;

function makeReq(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new Request(url, { headers }));
}

describe('security middleware', () => {
  describe('applySecurityHeaders', () => {
    it('sets X-Frame-Options DENY for /admin paths', () => {
      const req = makeReq('http://localhost/admin/bookings');
      const res = applySecurityHeaders(req, NextResponse.next());
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('sets X-Frame-Options DENY for /api/admin paths', () => {
      const req = makeReq('http://localhost/api/admin/bookings');
      const res = applySecurityHeaders(req, NextResponse.next());
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('sets X-Frame-Options SAMEORIGIN for public paths', () => {
      const req = makeReq('http://localhost/');
      const res = applySecurityHeaders(req, NextResponse.next());
      expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    });

    it('sets X-Content-Type-Options nosniff everywhere', () => {
      const adminRes = applySecurityHeaders(
        makeReq('http://localhost/admin'),
        NextResponse.next(),
      );
      const publicRes = applySecurityHeaders(
        makeReq('http://localhost/some-event'),
        NextResponse.next(),
      );
      expect(adminRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(publicRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('sets Referrer-Policy strict-origin-when-cross-origin everywhere', () => {
      const res = applySecurityHeaders(
        makeReq('http://localhost/'),
        NextResponse.next(),
      );
      expect(res.headers.get('Referrer-Policy')).toBe(
        'strict-origin-when-cross-origin',
      );
    });

    it('sets Permissions-Policy denying camera/mic/geolocation', () => {
      const res = applySecurityHeaders(
        makeReq('http://localhost/'),
        NextResponse.next(),
      );
      const policy = res.headers.get('Permissions-Policy') ?? '';
      expect(policy).toContain('camera=()');
      expect(policy).toContain('microphone=()');
      expect(policy).toContain('geolocation=()');
    });

    it('omits HSTS when the request is plain http (local dev)', () => {
      const res = applySecurityHeaders(
        makeReq('http://localhost/'),
        NextResponse.next(),
      );
      expect(res.headers.get('Strict-Transport-Security')).toBeNull();
    });

    it('sets HSTS when X-Forwarded-Proto is https and proxy is trusted', () => {
      const prev = process.env.SLOTTY_TRUST_PROXY;
      process.env.SLOTTY_TRUST_PROXY = 'true';
      try {
        const res = applySecurityHeaders(
          makeReq('http://localhost/', { 'x-forwarded-proto': 'https' }),
          NextResponse.next(),
        );
        const hsts = res.headers.get('Strict-Transport-Security');
        expect(hsts).toBeTruthy();
        expect(hsts).toContain('max-age=63072000');
        expect(hsts).toContain('includeSubDomains');
      } finally {
        if (prev === undefined) delete process.env.SLOTTY_TRUST_PROXY;
        else process.env.SLOTTY_TRUST_PROXY = prev;
      }
    });

    it('does NOT honor X-Forwarded-Proto when proxy trust is disabled', () => {
      const prev = process.env.SLOTTY_TRUST_PROXY;
      process.env.SLOTTY_TRUST_PROXY = 'false';
      try {
        const res = applySecurityHeaders(
          makeReq('http://localhost/', { 'x-forwarded-proto': 'https' }),
          NextResponse.next(),
        );
        expect(res.headers.get('Strict-Transport-Security')).toBeNull();
      } finally {
        if (prev === undefined) delete process.env.SLOTTY_TRUST_PROXY;
        else process.env.SLOTTY_TRUST_PROXY = prev;
      }
    });

    it('sets a Content-Security-Policy with frame-ancestors none', () => {
      const res = applySecurityHeaders(
        makeReq('http://localhost/'),
        NextResponse.next(),
      );
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain('https://lh3.googleusercontent.com');
    });

    it('does not overwrite a CSP that downstream already set', () => {
      const req = makeReq('http://localhost/');
      const res = NextResponse.next();
      res.headers.set('Content-Security-Policy', "default-src 'none'");
      applySecurityHeaders(req, res);
      expect(res.headers.get('Content-Security-Policy')).toBe(
        "default-src 'none'",
      );
    });
  });

  describe('buildCsp', () => {
    it('omits Cloudflare Turnstile sources when disabled', () => {
      const prevSite = process.env.SLOTTY_TURNSTILE_SITE_KEY;
      const prevSecret = process.env.SLOTTY_TURNSTILE_SECRET;
      delete process.env.SLOTTY_TURNSTILE_SITE_KEY;
      delete process.env.SLOTTY_TURNSTILE_SECRET;
      try {
        const csp = buildCsp({ isAdmin: false });
        expect(csp).not.toContain('challenges.cloudflare.com');
      } finally {
        if (prevSite !== undefined) process.env.SLOTTY_TURNSTILE_SITE_KEY = prevSite;
        if (prevSecret !== undefined) process.env.SLOTTY_TURNSTILE_SECRET = prevSecret;
      }
    });

    it('includes Cloudflare Turnstile sources when enabled', () => {
      const prevSite = process.env.SLOTTY_TURNSTILE_SITE_KEY;
      const prevSecret = process.env.SLOTTY_TURNSTILE_SECRET;
      process.env.SLOTTY_TURNSTILE_SITE_KEY = 'site';
      process.env.SLOTTY_TURNSTILE_SECRET = 'secret';
      try {
        const csp = buildCsp({ isAdmin: false });
        expect(csp).toContain('https://challenges.cloudflare.com');
        expect(csp).toContain('frame-src https://challenges.cloudflare.com');
      } finally {
        if (prevSite === undefined) delete process.env.SLOTTY_TURNSTILE_SITE_KEY;
        else process.env.SLOTTY_TURNSTILE_SITE_KEY = prevSite;
        if (prevSecret === undefined) delete process.env.SLOTTY_TURNSTILE_SECRET;
        else process.env.SLOTTY_TURNSTILE_SECRET = prevSecret;
      }
    });
  });

  describe('isHttps', () => {
    it('returns true for https:// URLs', () => {
      const req = makeReq('https://book.example.com/');
      expect(isHttps(req)).toBe(true);
    });
    it('returns false for plain http with no proxy header', () => {
      const req = makeReq('http://localhost/');
      expect(isHttps(req)).toBe(false);
    });
  });
});
