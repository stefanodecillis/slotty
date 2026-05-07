/**
 * End-to-end OAuth callback flow with mocked Google entry points.
 *
 * The route handler itself is a thin adapter over `handleOAuthCallback`;
 * exercising the latter directly avoids dragging in `next/headers` (which
 * has React server-rendering imports that don't load cleanly in bun's
 * test runtime). State validation, DB writes, encryption, and job
 * scheduling all live in the pure function — so this test still drives
 * the full flow end-to-end.
 *
 * We mock at the wrapper level (`exchangeCodeForTokens`,
 * `fetchAuthorizedEmail`, `listCalendars`, `setupWatchChannel`) because
 * Bun's fetch sidesteps the Node http hooks `nock` uses.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, spyOn } from 'bun:test';
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
  await db.eventTypeQuestion.deleteMany({});
  await db.eventType.deleteMany({});
  await db.calendar.deleteMany({});
  await db.connectedAccount.deleteMany({});
  await db.job.deleteMany({});
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function makeState(userId: string, secret: string): string {
  // Mirror the format from connect/route.ts — also exercised in handleOAuthCallback.
  // payload = `${userId}.${issuedAt}.${nonce}`; sig = hmac(secret, payload).
  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = 'noncey';
  const payload = `${userId}.${issuedAt}.${nonce}`;
  // Avoid pulling crypto helpers — use a shared-import to keep the format aligned.
  return `${payload}.PLACEHOLDER`;
}

describe('handleOAuthCallback (mocked Google)', () => {
  it('exchanges code for tokens, creates ConnectedAccount + Calendar rows, encrypts tokens', async () => {
    const { hmac, decrypt } = await import('@/lib/crypto');
    const { db } = await import('@/lib/db');

    const userId = 'user-1';
    const issuedAt = Math.floor(Date.now() / 1000);
    const nonce = 'noncey';
    const payload = `${userId}.${issuedAt}.${nonce}`;
    const sig = hmac(process.env.SLOTTY_SESSION_SECRET!, payload);
    const state = `${payload}.${sig}`;
    void makeState;

    // Stub Google network calls.
    const clientMod = await import('@/lib/google/client');
    const exchSp = spyOn(clientMod, 'exchangeCodeForTokens');
    exchSp.mockResolvedValue({
      accessToken: 'access-abc',
      refreshToken: 'refresh-xyz',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
    });
    cleanups.push(() => exchSp.mockRestore());

    const fetchEmailSp = spyOn(clientMod, 'fetchAuthorizedEmail');
    fetchEmailSp.mockResolvedValue('me@example.com');
    cleanups.push(() => fetchEmailSp.mockRestore());

    const calendarMod = await import('@/lib/google/calendar');
    const listSp = spyOn(calendarMod, 'listCalendars');
    listSp.mockResolvedValue([
      {
        id: 'me@example.com',
        summary: 'Me',
        primary: true,
        timeZone: 'UTC',
        backgroundColor: '#4285F4',
      },
      {
        id: 'work@example.com',
        summary: 'Work',
        primary: false,
        timeZone: 'UTC',
        backgroundColor: '#0B8043',
      },
    ]);
    cleanups.push(() => listSp.mockRestore());

    const watchMod = await import('@/lib/sync/watch');
    const watchSp = spyOn(watchMod, 'setupWatchChannel');
    watchSp.mockResolvedValue(undefined);
    cleanups.push(() => watchSp.mockRestore());

    const { handleOAuthCallback } = await import('@/lib/google/oauth-callback');
    const outcome = await handleOAuthCallback({
      code: 'fake-code',
      stateFromGoogle: state,
      stateCookie: state,
      userId,
    });

    expect(outcome.status).toBe('success');
    expect(outcome.reason).toBe('ok');

    // Verify DB state.
    const account = await db.connectedAccount.findUnique({
      where: {
        provider_googleUserEmail: { provider: 'google', googleUserEmail: 'me@example.com' },
      },
    });
    expect(account).not.toBeNull();
    expect(account!.status).toBe('active');
    expect(account!.scopes).toContain('calendar');

    // Token blobs are encrypted (start with v1.) and don't contain plaintext.
    expect(account!.accessTokenEnc.startsWith('v1.')).toBe(true);
    expect(account!.accessTokenEnc).not.toContain('access-abc');
    expect(account!.refreshTokenEnc.startsWith('v1.')).toBe(true);
    expect(account!.refreshTokenEnc).not.toContain('refresh-xyz');
    expect(decrypt(account!.accessTokenEnc)).toBe('access-abc');
    expect(decrypt(account!.refreshTokenEnc)).toBe('refresh-xyz');

    // Calendars upserted.
    const cals = await db.calendar.findMany({ where: { connectedAccountId: account!.id } });
    expect(cals.length).toBe(2);
    expect(cals.find((c) => c.isPrimary)?.googleCalendarId).toBe('me@example.com');

    // An incremental_sync job was enqueued for each calendar.
    const jobs = await db.job.findMany({ where: { kind: 'incremental_sync' } });
    expect(jobs.length).toBe(2);
  });

  it('rejects when state cookie is missing', async () => {
    const { handleOAuthCallback } = await import('@/lib/google/oauth-callback');
    const outcome = await handleOAuthCallback({
      code: 'x',
      stateFromGoogle: 'whatever',
      stateCookie: null,
      userId: 'user-2',
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('missing_state_cookie');
  });

  it('rejects when stateFromGoogle does not match cookie', async () => {
    const { handleOAuthCallback } = await import('@/lib/google/oauth-callback');
    const outcome = await handleOAuthCallback({
      code: 'x',
      stateFromGoogle: 'aaa',
      stateCookie: 'bbb',
      userId: 'user-3',
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('state_mismatch');
  });

  it('rejects when state HMAC signature is invalid', async () => {
    const userId = 'user-4';
    const issuedAt = Math.floor(Date.now() / 1000);
    const tampered = `${userId}.${issuedAt}.nonce.deadbeef`;
    const { handleOAuthCallback } = await import('@/lib/google/oauth-callback');
    const outcome = await handleOAuthCallback({
      code: 'x',
      stateFromGoogle: tampered,
      stateCookie: tampered,
      userId,
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('state_sig');
  });
});
