import { env } from '@/lib/env';

/** Admin redirects and OAuth use the private origin, or the legacy public URL. */
export function adminUrl(path: string): URL {
  return new URL(path, env.SLOTTY_ADMIN_ORIGIN ?? env.SLOTTY_PUBLIC_URL);
}

export function adminCookieSecure(): boolean {
  return adminUrl('/').protocol === 'https:';
}
