import { describe, it, expect, beforeEach } from 'bun:test';
import { randomBytes } from 'node:crypto';

async function createTestUser() {
  const { db } = await import('@/lib/db');
  return db.user.create({
    data: {
      username: `tester-${randomBytes(4).toString('hex')}`,
      passwordHash: 'placeholder-not-a-real-hash',
      email: 'tester@example.com',
      displayName: 'Tester',
    },
  });
}

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.session.deleteMany({});
  await db.user.deleteMany({});
});

describe('lucia session lifecycle', () => {
  it('creates and validates a session round-trip', async () => {
    const { lucia } = await import('@/lib/auth/lucia');
    const user = await createTestUser();

    const session = await lucia.createSession(user.id, {});
    expect(session.id).toBeTruthy();

    const result = await lucia.validateSession(session.id);
    expect(result.session).not.toBeNull();
    expect(result.user).not.toBeNull();
    if (result.user) {
      expect(result.user.id).toBe(user.id);
      expect(result.user.username).toBe(user.username);
      // Sensitive fields must not leak through getUserAttributes.
      const u = result.user as unknown as Record<string, unknown>;
      expect(u['passwordHash']).toBeUndefined();
      expect(u['totpSecretEnc']).toBeUndefined();
    }
  });

  it('returns nulls for an unknown session id', async () => {
    const { lucia } = await import('@/lib/auth/lucia');
    const result = await lucia.validateSession('does-not-exist');
    expect(result.session).toBeNull();
    expect(result.user).toBeNull();
  });

  it('flags fresh=true when session expiry is refreshed', async () => {
    const { lucia } = await import('@/lib/auth/lucia');
    const { db } = await import('@/lib/db');
    const user = await createTestUser();

    const session = await lucia.createSession(user.id, {});
    // Pull the original expiry then push it to mid-life so validateSession refreshes it.
    const original = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    const halfLife = new Date(Date.now() + 1000 * 60 * 60 * 24); // 1 day from now
    await db.session.update({
      where: { id: session.id },
      data: { expiresAt: halfLife },
    });

    const result = await lucia.validateSession(session.id);
    expect(result.session).not.toBeNull();
    if (result.session) {
      expect(result.session.fresh).toBe(true);
      // Refreshed expiry should be later than the manually-shortened value.
      expect(result.session.expiresAt.getTime()).toBeGreaterThan(halfLife.getTime());
    }
    void original;
  });

  it('invalidating a session removes it', async () => {
    const { lucia } = await import('@/lib/auth/lucia');
    const user = await createTestUser();
    const session = await lucia.createSession(user.id, {});
    await lucia.invalidateSession(session.id);
    const result = await lucia.validateSession(session.id);
    expect(result.session).toBeNull();
  });

  it('invalidateUserSessions clears every session for that user', async () => {
    const { lucia } = await import('@/lib/auth/lucia');
    const user = await createTestUser();
    const s1 = await lucia.createSession(user.id, {});
    const s2 = await lucia.createSession(user.id, {});
    await lucia.invalidateUserSessions(user.id);
    expect((await lucia.validateSession(s1.id)).session).toBeNull();
    expect((await lucia.validateSession(s2.id)).session).toBeNull();
  });
});
