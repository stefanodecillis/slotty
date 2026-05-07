import { Lucia } from 'lucia';
import { PrismaAdapter } from '@lucia-auth/adapter-prisma';

import { db } from '@/lib/db';

/**
 * Database-row shape that the adapter returns. We strip secrets in
 * `getUserAttributes` so they never reach userland.
 */
type DatabaseUserAttributes = {
  username: string;
  email: string;
  display_name: string;
  avatar_path: string | null;
  bio: string | null;
  timezone: string;
  locale: string;
  theme: string;
  seed_color: string;
  week_start: number;
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
    displayName: attributes.display_name,
    avatarPath: attributes.avatar_path,
    bio: attributes.bio,
    timezone: attributes.timezone,
    locale: attributes.locale,
    theme: attributes.theme,
    seedColor: attributes.seed_color,
    weekStart: attributes.week_start,
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
