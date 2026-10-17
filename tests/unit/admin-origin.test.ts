import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';

function probe(origin?: string, publicUrl = 'http://book.example.com', code?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, SLOTTY_PUBLIC_URL: publicUrl,
    SLOTTY_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    SLOTTY_SESSION_SECRET: 'a'.repeat(64),
    SLOTTY_GOOGLE_CLIENT_ID: 'synthetic-client', SLOTTY_GOOGLE_CLIENT_SECRET: 'synthetic-secret' };
  delete env.SLOTTY_ADMIN_ORIGIN;
  if (origin !== undefined) env.SLOTTY_ADMIN_ORIGIN = origin;
  return spawnSync(process.execPath, ['-e', code ?? `
    import { adminUrl, adminCookieSecure } from './src/lib/admin-url';
    console.log(JSON.stringify([adminUrl('/api/admin/calendars/callback').href, adminCookieSecure()]));
  `], { env, encoding: 'utf8' });
}

describe('private admin origin', () => {
  it('defaults to the public URL for existing HTTP deployments', () => {
    const result = probe();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['http://book.example.com/api/admin/calendars/callback', false]);
  });
  it('uses the private HTTPS origin for callback and cookie security', () => {
    const result = probe('https://slotty.example.com/');
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['https://slotty.example.com/api/admin/calendars/callback', true]);
  });
  it('does not inherit public HTTPS cookie security for an HTTP admin origin', () => {
    expect(JSON.parse(probe('http://private.example.com', 'https://book.example.com').stdout)[1]).toBe(false);
  });
  it('preserves HTTPS public fallback for cookie security', () => {
    expect(JSON.parse(probe(undefined, 'https://book.example.com').stdout)[1]).toBe(true);
  });
  it('uses the admin origin in the real OAuth consent URL without contacting Google', () => {
    const result = probe('https://slotty.example.com', 'https://book.example.com', `
      import { buildAuthUrl } from './src/lib/google/client';
      console.log(new URL(buildAuthUrl('synthetic-state')).searchParams.get('redirect_uri'));
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('https://slotty.example.com/api/admin/calendars/callback');
  });
  it('keeps Google watch registration public when admin origin is private', () => {
    const result = probe('https://slotty.example.com', 'https://book.example.com', `
      import { mock } from 'bun:test';
      mock.module('@/lib/db', () => ({ db: { calendar: {
        findUnique: async () => ({ id: 'synthetic', googleCalendarId: 'synthetic-calendar',
          connectedAccountId: 'synthetic-account', connectedAccount: { status: 'active' } }),
        update: async () => ({}),
      } } }));
      let address;
      mock.module('@/lib/google/calendar', () => ({
        watchCalendar: async (_a, _c, channelId, url) => {
          address = url;
          return { channelId, resourceId: 'synthetic-resource', expiration: Date.now() + 100000 };
        },
        stopWatch: async () => {},
      }));
      const { setupWatchChannel } = await import('./src/lib/sync/watch');
      await setupWatchChannel('synthetic');
      console.log('ADDRESS=' + address);
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('ADDRESS=https://book.example.com/api/webhooks/google');
  });
  for (const origin of ['', 'not-a-url', 'ftp://slotty.example.com', 'https://slotty.example.com/path',
    'https://user:pass@slotty.example.com', 'https://slotty.example.com/?x=1', 'https://slotty.example.com/#fragment']) {
    it(`rejects non-origin ${JSON.stringify(origin)}`, () => {
      expect(probe(origin).status).not.toBe(0);
    });
  }
});
