import { Lucia } from 'lucia';
import { PrismaAdapter } from '@lucia-auth/adapter-prisma';

import { db } from '@/lib/db';

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
      secure: process.env.NODE_ENV === 'production',
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
  locale: string;
  theme: string;
  seedColor: string;
  weekStart: number;
};
