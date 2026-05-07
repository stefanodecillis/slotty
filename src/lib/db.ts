import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __slotty_prisma__: PrismaClient | undefined;
}

export const db: PrismaClient =
  globalThis.__slotty_prisma__ ??
  new PrismaClient({
    log: process.env.SLOTTY_LOG_LEVEL === 'debug' ? ['query', 'error', 'warn'] : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__slotty_prisma__ = db;
}
