import pino from 'pino';
import { env } from './env';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: env.SLOTTY_LOG_LEVEL,
  base: { app: 'slotty' },
  redact: {
    paths: [
      'password',
      'passwordHash',
      'password_hash',
      '*.password',
      'token',
      'access_token',
      'refresh_token',
      '*.token',
      '*.access_token',
      '*.refresh_token',
      'authorization',
      'cookie',
      'set-cookie',
      'SLOTTY_ENCRYPTION_KEY',
      'SLOTTY_SESSION_SECRET',
      'SLOTTY_SMTP_PASS',
      'SLOTTY_GOOGLE_CLIENT_SECRET',
    ],
    remove: true,
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      }
    : {}),
});
