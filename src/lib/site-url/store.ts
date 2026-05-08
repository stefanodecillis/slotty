/**
 * Runtime-editable public URL with env fallback.
 *
 * `SLOTTY_PUBLIC_URL` is required at boot — `lib/env.ts` rejects an empty
 * value, and several load-bearing systems read it directly:
 *   - Google OAuth redirect URI (must match what's registered in Google
 *     Cloud Console — admin can't change this without coordinating)
 *   - Google Calendar webhook channel address (Google calls this URL
 *     directly; changing it without re-registering channels breaks sync)
 *   - Cookie `secure` flag (must match the actual origin scheme)
 *   - CSRF origin host check
 *
 * What this module does is layer a runtime override for the *cosmetic*
 * uses of the public URL — the URLs we hand to bookers and admins:
 *   - invite link surfaced when the admin generates a one-time link
 *   - booker's "manage this booking" URL (in Google event description and
 *     in the booking POST response)
 *   - admin "copy public URL" buttons on the event-types list
 *
 * Override resolution: read DB row → fall back to env. The DB row is
 * cached in process memory; `setPublicUrl` invalidates the cache. The
 * cache is unbounded (only one key) and refreshed lazily on first read,
 * so there's no startup hook to wire.
 */
import { z } from 'zod';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

const KEY = 'publicUrl';

const urlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((s) => /^https?:\/\//i.test(s), { message: 'Must be http(s)' });

let cachedOverride: string | null | undefined; // undefined = never loaded; null = no override

function normaliseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

async function loadOverride(): Promise<string | null> {
  const row = await db.siteSetting.findUnique({ where: { key: KEY } });
  return row?.value ?? null;
}

/**
 * Return the public URL the admin wants user-facing links to use. Trailing
 * slashes are stripped. Falls back to `env.SLOTTY_PUBLIC_URL` if no override
 * is set.
 */
export async function getPublicUrl(): Promise<string> {
  if (cachedOverride === undefined) {
    cachedOverride = await loadOverride();
  }
  return normaliseUrl(cachedOverride ?? env.SLOTTY_PUBLIC_URL);
}

/**
 * Read both layers separately — useful for the settings UI that wants to
 * show the env value as a fallback hint and the override (if any) as the
 * editable field.
 */
export async function getPublicUrlState(): Promise<{ override: string | null; envValue: string; effective: string }> {
  if (cachedOverride === undefined) {
    cachedOverride = await loadOverride();
  }
  const envValue = normaliseUrl(env.SLOTTY_PUBLIC_URL);
  const override = cachedOverride ? normaliseUrl(cachedOverride) : null;
  return { override, envValue, effective: override ?? envValue };
}

/**
 * Set or clear the override. Passing null/empty clears it (effective URL
 * reverts to env). Validates that the value parses as a URL.
 */
export async function setPublicUrl(value: string | null): Promise<void> {
  if (value === null || value.trim() === '') {
    await db.siteSetting.deleteMany({ where: { key: KEY } });
    cachedOverride = null;
    return;
  }

  const parsed = urlSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidPublicUrlError(parsed.error.issues[0]?.message ?? 'Invalid URL');
  }
  const normalised = normaliseUrl(parsed.data);

  await db.siteSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: normalised },
    update: { value: normalised },
  });
  cachedOverride = normalised;
}

export class InvalidPublicUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPublicUrlError';
  }
}

/**
 * Test-only: drop the in-process cache so the next read re-queries the DB.
 * Safe to call in production (just costs one extra query) but unnecessary.
 */
export function _resetCacheForTests(): void {
  cachedOverride = undefined;
}
