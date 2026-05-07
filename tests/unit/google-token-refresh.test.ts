/**
 * Verifies that getAuthedClient subscribes a `tokens` listener that persists
 * a refreshed access token (encrypted) back to the ConnectedAccount row.
 *
 * For the proactive-refresh path we stub `OAuth2Client.refreshAccessToken`
 * directly — Bun's fetch sidesteps the Node http hooks `nock` uses.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.SLOTTY_PUBLIC_URL ??= 'http://localhost:3000';
  process.env.SLOTTY_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.SLOTTY_SESSION_SECRET ??= randomBytes(64).toString('base64');
  process.env.SLOTTY_GOOGLE_CLIENT_ID ??= 'test-client-id';
  process.env.SLOTTY_GOOGLE_CLIENT_SECRET ??= 'test-client-secret';
});

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.busyEvent.deleteMany({});
  await db.bookingHistory.deleteMany({});
  await db.booking.deleteMany({});
  await db.eventTypeQuestion.deleteMany({});
  await db.eventType.deleteMany({});
  await db.calendar.deleteMany({});
  await db.connectedAccount.deleteMany({});
});

describe('OAuth token refresh persistence', () => {
  it('emits `tokens` → encrypted value persisted to DB', async () => {
    const { getAuthedClient } = await import('@/lib/google/client');
    const { db } = await import('@/lib/db');
    const { encrypt, decrypt } = await import('@/lib/crypto');

    const account = await db.connectedAccount.create({
      data: {
        provider: 'google',
        googleUserEmail: 'refresh@example.com',
        accessTokenEnc: encrypt('old-access'),
        refreshTokenEnc: encrypt('refresh-tok'),
        scopes: 'calendar.readonly',
        // Far in future so getAuthedClient does not perform proactive refresh.
        expiresAt: new Date(Date.now() + 50 * 60 * 1000),
        status: 'active',
      },
    });

    const client = await getAuthedClient(account.id);

    // Simulate Google's token-refresh notification by emitting the event.
    const newExpiry = Date.now() + 60 * 60 * 1000;
    client.emit('tokens', {
      access_token: 'new-access',
      expiry_date: newExpiry,
      token_type: 'Bearer',
      scope: 'calendar.readonly',
    });

    // Persistence is async (fire-and-forget). Wait a moment then read back.
    await new Promise((r) => setTimeout(r, 50));

    const fresh = await db.connectedAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(fresh.accessTokenEnc).not.toBe(account.accessTokenEnc);
    expect(decrypt(fresh.accessTokenEnc)).toBe('new-access');
    expect(fresh.expiresAt.getTime()).toBe(newExpiry);
    // Refresh token unchanged because tokens.refresh_token was not present.
    expect(decrypt(fresh.refreshTokenEnc)).toBe('refresh-tok');
  });

  it('proactive refresh triggers when expiry is within 20% buffer', async () => {
    // Stub OAuth2Client.prototype.refreshAccessToken so we don't hit network.
    const { OAuth2Client } = await import('google-auth-library');
    const original = OAuth2Client.prototype.refreshAccessToken;
    let called = 0;
    (OAuth2Client.prototype as unknown as {
      refreshAccessToken: () => Promise<{ credentials: Record<string, unknown> }>;
    }).refreshAccessToken = async function () {
      called += 1;
      return {
        credentials: {
          access_token: 'fresh-access',
          expiry_date: Date.now() + 60 * 60 * 1000,
          token_type: 'Bearer',
        },
      };
    };

    try {
      const { getAuthedClient } = await import('@/lib/google/client');
      const { db } = await import('@/lib/db');
      const { encrypt, decrypt } = await import('@/lib/crypto');

      const account = await db.connectedAccount.create({
        data: {
          provider: 'google',
          googleUserEmail: 'proactive@example.com',
          accessTokenEnc: encrypt('stale-access'),
          refreshTokenEnc: encrypt('refresh'),
          scopes: 'calendar.readonly',
          expiresAt: new Date(Date.now() + 60 * 1000), // 1 minute → triggers refresh
          status: 'active',
        },
      });

      await getAuthedClient(account.id);
      // Persistence happens synchronously in this path, but allow a tick.
      await new Promise((r) => setTimeout(r, 10));

      expect(called).toBeGreaterThanOrEqual(1);

      const updated = await db.connectedAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(decrypt(updated.accessTokenEnc)).toBe('fresh-access');
    } finally {
      (OAuth2Client.prototype as unknown as {
        refreshAccessToken: typeof original;
      }).refreshAccessToken = original;
    }
  });
});
