/**
 * site-url override resolver.
 *
 * The DB-backed override layers above SLOTTY_PUBLIC_URL — used by the
 * cosmetic URL builders (invite links, manage links, admin "copy public
 * URL" buttons). Confirms three properties:
 *   1. With no row, getPublicUrl() returns the env value (normalised).
 *   2. setPublicUrl persists, normalises trailing slashes, and the next
 *      read sees the new value.
 *   3. setPublicUrl(null) clears the override and reverts to env.
 *   4. Invalid URLs throw InvalidPublicUrlError.
 */
import { describe, it, expect, beforeEach } from 'bun:test';

import {
  getPublicUrl,
  getPublicUrlState,
  setPublicUrl,
  InvalidPublicUrlError,
  _resetCacheForTests,
} from '@/lib/site-url/store';
import { env } from '@/lib/env';

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.siteSetting.deleteMany({});
  _resetCacheForTests();
});

describe('site-url store', () => {
  it('falls back to env when no override exists', async () => {
    const url = await getPublicUrl();
    // env value, with trailing slashes stripped
    expect(url).toBe(env.SLOTTY_PUBLIC_URL.replace(/\/+$/, ''));
  });

  it('exposes both layers via getPublicUrlState', async () => {
    const state = await getPublicUrlState();
    expect(state.override).toBeNull();
    expect(state.effective).toBe(state.envValue);
  });

  it('persists an override and the next read reflects it (with trailing slash stripped)', async () => {
    await setPublicUrl('https://book.example.com/');
    const url = await getPublicUrl();
    expect(url).toBe('https://book.example.com');

    const state = await getPublicUrlState();
    expect(state.override).toBe('https://book.example.com');
    expect(state.effective).toBe('https://book.example.com');
  });

  it('clears the override on null/empty and reverts to env', async () => {
    await setPublicUrl('https://book.example.com');
    expect((await getPublicUrlState()).override).toBe('https://book.example.com');

    await setPublicUrl(null);
    const state = await getPublicUrlState();
    expect(state.override).toBeNull();
    expect(state.effective).toBe(state.envValue);
  });

  it('rejects invalid URLs with InvalidPublicUrlError', async () => {
    await expect(setPublicUrl('not-a-url')).rejects.toBeInstanceOf(InvalidPublicUrlError);
    await expect(setPublicUrl('ftp://example.com')).rejects.toBeInstanceOf(InvalidPublicUrlError);
  });
});
