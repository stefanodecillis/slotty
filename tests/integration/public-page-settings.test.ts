import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Database } from 'bun:sqlite';

// Keep Next/auth module stubs isolated so they cannot change other test files.
function probe(code: string) {
  return spawnSync(process.execPath, ['-e', `
    import { mock } from 'bun:test';
    import { randomUUID } from 'node:crypto';
    let authorized = true;
    let validOrigin = true;
    const revalidated = [];
    mock.module('next/headers', () => ({ headers: () => new Headers() }));
    mock.module('next/cache', () => ({ revalidatePath: (path) => revalidated.push(path) }));
    mock.module('@/lib/auth/csrf', () => ({ validateOrigin: () => validOrigin }));
    let ownerId;
    mock.module('@/lib/auth/session', () => ({ requireUserOrRedirect: async () => {
      if (!authorized) throw new Error('AUTH_REQUIRED');
      return { id: ownerId };
    } }));
    const { db } = await import('./src/lib/db');
    const { updatePublicPageSettings } = await import('./src/app/admin/settings/public-page/actions');
    const owner = await db.user.create({ data: {
      username: 'public-page-' + randomUUID(), passwordHash: 'placeholder',
      displayName: 'Private owner', email: 'owner@example.com', bio: 'Private bio',
    } });
    ownerId = owner.id;
    function form(overrides = {}) {
      const data = new FormData();
      for (const [key, value] of Object.entries({
        publicPageShowName: 'true', publicPageShowAvatar: 'false', publicPageShowBio: 'true',
        ...overrides,
      })) data.set(key, value);
      return data;
    }
    try {
      ${code}
    } finally {
      await db.user.delete({ where: { id: owner.id } });
      await db.$disconnect();
    }
  `], { env: process.env, encoding: 'utf8', timeout: 30000 });
}

function output(code: string) {
  const result = probe(code);
  expect(result.status, result.stderr).toBe(0);
  const line = result.stdout.split('\n').find((value) => value.startsWith('RESULT='));
  expect(line, result.stdout).toBeDefined();
  return JSON.parse(line!.slice('RESULT='.length));
}

describe('public homepage profile settings', () => {
  it('hides profile details on existing rows when applying the migration', () => {
    const database = new Database(':memory:');
    try {
      database.exec('CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES (\'existing-owner\');');
      database.exec(readFileSync('prisma/migrations/20261017160000_public_page_profile_visibility/migration.sql', 'utf8'));
      expect(database.query('SELECT * FROM users').get()).toEqual({
        id: 'existing-owner',
        public_page_show_name: 0,
        public_page_show_avatar: 0,
        public_page_show_bio: 0,
      });
    } finally {
      database.close();
    }
  });

  it('defaults new owners to private and saves independent choices only for the authenticated owner', () => {
    const result = output(`
      const other = await db.user.create({ data: {
        username: 'public-page-other-' + randomUUID(), passwordHash: 'placeholder',
        displayName: 'Other owner', email: 'other@example.com',
      } });
      try {
        const result = await updatePublicPageSettings({ success: false }, form({ userId: other.id }));
        const saved = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
        const untouched = await db.user.findUniqueOrThrow({ where: { id: other.id } });
        const disabled = await updatePublicPageSettings({ success: false }, form({
          publicPageShowName: 'false', publicPageShowAvatar: 'true', publicPageShowBio: 'false',
        }));
        const changed = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
        const flags = (row) => [row.publicPageShowName, row.publicPageShowAvatar, row.publicPageShowBio];
        console.log('RESULT=' + JSON.stringify({
          defaults: flags(owner), result, saved: flags(saved), other: flags(untouched),
          identity: [saved.displayName, saved.bio], disabled, changed: flags(changed), revalidated,
        }));
      } finally { await db.user.delete({ where: { id: other.id } }); }
    `);
    expect(result.defaults).toEqual([false, false, false]);
    expect(result.result).toEqual({ success: true });
    expect(result.saved).toEqual([true, false, true]);
    expect(result.other).toEqual([false, false, false]);
    expect(result.identity).toEqual(['Private owner', 'Private bio']);
    expect(result.disabled).toEqual({ success: true });
    expect(result.changed).toEqual([false, true, false]);
    expect(result.revalidated).toEqual(['/', '/admin/settings/public-page', '/', '/admin/settings/public-page']);
  });

  it('rejects malformed, missing, and file values without changing visibility', () => {
    const result = output(`
      const invalid = await updatePublicPageSettings({ success: false }, form({ publicPageShowName: 'yes' }));
      const missingForm = form(); missingForm.delete('publicPageShowAvatar');
      const missing = await updatePublicPageSettings({ success: false }, missingForm);
      const file = await updatePublicPageSettings({ success: false }, form({ publicPageShowBio: new Blob(['true']) }));
      const saved = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
      console.log('RESULT=' + JSON.stringify({ invalid, missing, file, revalidated,
        visibility: [saved.publicPageShowName, saved.publicPageShowAvatar, saved.publicPageShowBio],
      }));
    `);
    for (const action of [result.invalid, result.missing, result.file]) {
      expect(action.success).toBe(false);
      expect(action.error).toBeDefined();
    }
    expect(result.visibility).toEqual([false, false, false]);
    expect(result.revalidated).toEqual([]);
  });

  it('requires authentication and honors origin validation before writing', () => {
    const result = output(`
      authorized = false;
      let authenticationError;
      try { await updatePublicPageSettings({ success: false }, form()); }
      catch (error) { authenticationError = error.message; }
      authorized = true;
      validOrigin = false;
      const rejectedOrigin = await updatePublicPageSettings({ success: false }, form());
      const saved = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
      console.log('RESULT=' + JSON.stringify({ authenticationError, rejectedOrigin, revalidated,
        visibility: [saved.publicPageShowName, saved.publicPageShowAvatar, saved.publicPageShowBio],
      }));
    `);
    expect(result.authenticationError).toBe('AUTH_REQUIRED');
    expect(result.rejectedOrigin).toEqual({ success: false, error: 'Forbidden' });
    expect(result.visibility).toEqual([false, false, false]);
    expect(result.revalidated).toEqual([]);
  });
});
