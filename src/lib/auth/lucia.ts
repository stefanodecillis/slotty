import { Lucia } from 'lucia';
import { PrismaAdapter } from '@lucia-auth/adapter-prisma';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

/**
 * Database-row shape that the adapter returns. Prisma maps `@map("snake")`
 * columns back to camelCase TS field names — so the adapter passes us
 * camelCase keys here, NOT the underlying SQL column names.
 *
 * Strip secrets (passwordHash, totpSecretEnc) in `getUserAttributes` so
 * they never reach userland.
 */
type DatabaseUserAttributes = {
  username: string;
  email: string;
  displayName: string;
  avatarPath: string | null;
  bio: string | null;
  timezone: string;
  timezoneSet: boolean;
  locale: string;
  theme: string;
  seedColor: string;
  weekStart: number;
};

const adapter = new PrismaAdapter(db.session, db.user);

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    name: 'slotty_session',
    expires: false,
    attributes: {
      // Derive `secure` from the deployment's public URL scheme rather than
      // NODE_ENV. A self-hosted box reachable via plain HTTP (e.g. on a LAN
      // before TLS is wired up) is still production from Node's perspective —
      // but if we set Secure: true the browser silently drops the cookie and
      // every login appears to "fail" while actually succeeding server-side.
      // When the same deployment is later fronted by HTTPS, this flips
      // automatically with no code change.
      secure: env.SLOTTY_PUBLIC_URL.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
    },
  },
  getUserAttributes: (attributes) => ({
    username: attributes.username,
    email: attributes.email,
    displayName: attributes.displayName,
    avatarPath: attributes.avatarPath,
    bio: attributes.bio,
    timezone: attributes.timezone,
    timezoneSet: attributes.timezoneSet,
    locale: attributes.locale,
    theme: attributes.theme,
    seedColor: attributes.seedColor,
    weekStart: attributes.weekStart,
  }),
});

declare module 'lucia' {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: DatabaseUserAttributes;
  }
}

export type AuthUser = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  avatarPath: string | null;
  bio: string | null;
  timezone: string;
  timezoneSet: boolean;
  locale: string;
  theme: string;
  seedColor: string;
  weekStart: number;
};
