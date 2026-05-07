import { describe, it, expect, beforeAll } from 'bun:test';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.SLOTTY_PUBLIC_URL ??= 'http://localhost:3000';
  process.env.SLOTTY_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.SLOTTY_SESSION_SECRET ??= randomBytes(64).toString('base64');
  process.env.SLOTTY_DATABASE_URL ??= 'file:./test.db';
  process.env.SLOTTY_TRUST_PROXY = 'true';
});

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

  it('rejects POST when origin host differs from public URL', async () => {
    const { validateOrigin } = await import('@/lib/auth/csrf');
    const req = new Request('http://localhost:3000/admin', {
      method: 'POST',
      headers: { origin: 'http://attacker.example' },
    });
    expect(validateOrigin(req)).toBe(false);
  });

  it('falls back to Referer when Origin is missing', async () => {
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

  it('rejects POST with no origin and no referer', async () => {
    const { validateOrigin } = await import('@/lib/auth/csrf');
    const req = new Request('http://localhost:3000/admin', { method: 'POST' });
    expect(validateOrigin(req)).toBe(false);
  });
});
