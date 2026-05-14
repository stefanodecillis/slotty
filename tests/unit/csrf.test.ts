import { describe, it, expect, beforeAll } from 'bun:test';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.SLOTTY_PUBLIC_URL ??= 'http://localhost:3000';
  process.env.SLOTTY_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.SLOTTY_SESSION_SECRET ??= randomBytes(64).toString('base64');
  process.env.SLOTTY_DATABASE_URL ??= 'file:./test.db';
  process.env.SLOTTY_TRUST_PROXY = 'true';
});

// NOTE: The CSRF origin check is currently disabled at the source —
// `CSRF_ORIGIN_CHECK_ENABLED = false` in src/lib/auth/csrf.ts. It was
// turned off in commit a1414df to unblock self-host access from multiple
// hostnames (e.g. http://truenas:3210 LAN + https://book.example.com via
// reverse proxy). While the kill switch is off, validateOrigin returns
// `true` for every request regardless of Origin / Referer.
//
// The "accept" tests below all pass either way. The rejection tests are
// kept as `it.skip` so the original intent stays visible in the test
// output; flipping the switch back to `true` should restore them by
// removing the `.skip`.

describe('validateOrigin', () => {
  it('allows GET without an origin header', async () => {
    const { validateOrigin } = await import('@/lib/auth/csrf');
    const req = new Request('http://localhost:3000/admin', { method: 'GET' });
    expect(validateOrigin(req)).toBe(true);
  });

  it('allows HEAD/OPTIONS without an origin header', async () => {
    const { validateOrigin } = await import('@/lib/auth/csrf');
    const head = new Request('http://localhost:3000/admin', { method: 'HEAD' });
    const opts = new Request('http://localhost:3000/admin', { method: 'OPTIONS' });
    expect(validateOrigin(head)).toBe(true);
    expect(validateOrigin(opts)).toBe(true);
  });

  it('allows POST when origin matches public URL', async () => {
    const { validateOrigin } = await import('@/lib/auth/csrf');
    const req = new Request('http://localhost:3000/admin', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(validateOrigin(req)).toBe(true);
  });

  it.skip('rejects POST when origin host differs from public URL (kill switch off)', async () => {
    const { validateOrigin } = await import('@/lib/auth/csrf');
    const req = new Request('http://localhost:3000/admin', {
      method: 'POST',
      headers: { origin: 'http://attacker.example' },
    });
    expect(validateOrigin(req)).toBe(false);
  });

  it.skip('falls back to Referer when Origin is missing (kill switch off)', async () => {
    const { validateOrigin } = await import('@/lib/auth/csrf');
    const ok = new Request('http://localhost:3000/admin', {
      method: 'POST',
      headers: { referer: 'http://localhost:3000/some/page' },
    });
    expect(validateOrigin(ok)).toBe(true);

    const bad = new Request('http://localhost:3000/admin', {
      method: 'POST',
      headers: { referer: 'http://attacker.example/page' },
    });
    expect(validateOrigin(bad)).toBe(false);
  });

  it('accepts X-Forwarded-Host when SLOTTY_TRUST_PROXY is true', async () => {
    const { validateOrigin } = await import('@/lib/auth/csrf');
    const req = new Request('http://localhost:3000/admin', {
      method: 'POST',
      headers: {
        origin: 'http://other.example',
        'x-forwarded-host': 'localhost:3000',
      },
    });
    expect(validateOrigin(req)).toBe(true);
  });

  it.skip('rejects POST with no origin and no referer (kill switch off)', async () => {
    const { validateOrigin } = await import('@/lib/auth/csrf');
    const req = new Request('http://localhost:3000/admin', { method: 'POST' });
    expect(validateOrigin(req)).toBe(false);
  });

  // Documents the *current* contract while the kill switch is off:
  // every cross-origin or origin-less POST is accepted unconditionally.
  // Flipping CSRF_ORIGIN_CHECK_ENABLED back to true should make this
  // assertion fail — at which point remove it and un-skip the rejection
  // tests above.
  it('accepts cross-origin POST while CSRF origin check is disabled', async () => {
    const { validateOrigin } = await import('@/lib/auth/csrf');
    const cross = new Request('http://localhost:3000/admin', {
      method: 'POST',
      headers: { origin: 'http://attacker.example' },
    });
    const bare = new Request('http://localhost:3000/admin', { method: 'POST' });
    expect(validateOrigin(cross)).toBe(true);
    expect(validateOrigin(bare)).toBe(true);
  });
});
