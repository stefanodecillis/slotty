import pino, { type DestinationStream } from 'pino';
import { env } from './env';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * In dev we want readable colored output, but `pino-pretty`'s default
 * `transport: { target: 'pino-pretty' }` spawns a worker thread that
 * doesn't survive bundling (webpack tries to bundle it; Turbopack does
 * the same). The worker entry can't be located at runtime and the
 * process emits "the worker has exited" the moment any code logs.
 *
 * Workaround: write a tiny same-thread prettifier and feed it via a
 * `DestinationStream`. No worker. No bundler gotchas. Production keeps
 * structured JSON to stdout.
 */

const COLOR = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

function levelColor(level: number): string {
  if (level >= 50) return COLOR.red;
  if (level >= 40) return COLOR.yellow;
  if (level >= 30) return COLOR.green;
  if (level >= 20) return COLOR.cyan;
  return COLOR.dim;
}

function levelLabel(level: number): string {
  if (level >= 60) return 'FATAL';
  if (level >= 50) return 'ERROR';
  if (level >= 40) return 'WARN ';
  if (level >= 30) return 'INFO ';
  if (level >= 20) return 'DEBUG';
  return 'TRACE';
}

function formatTime(t: number): string {
  const d = new Date(t);
  return d.toISOString().slice(11, 23);
}

function devPrettifier(line: string): string {
  let log: Record<string, unknown>;
  try {
    log = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line;
  }

  const level = (log.level as number) ?? 30;
  const time = (log.time as number) ?? Date.now();
  const msg = (log.msg as string) ?? '';
  // Strip noisy keys from the inline payload.
  const omit = new Set(['level', 'time', 'msg', 'pid', 'hostname', 'app', 'v']);
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(log)) {
    if (!omit.has(k)) rest[k] = v;
  }

  const head =
    `${COLOR.dim}${formatTime(time)}${COLOR.reset} ` +
    `${levelColor(level)}${levelLabel(level)}${COLOR.reset} ` +
    `${COLOR.bold}${msg}${COLOR.reset}`;

  if (Object.keys(rest).length === 0) return head + '\n';

  const tail = JSON.stringify(rest);
  return `${head} ${COLOR.dim}${tail}${COLOR.reset}\n`;
}

const devStream: DestinationStream = {
  write(line: string) {
    process.stdout.write(devPrettifier(line));
  },
};

export const logger = isDev
  ? pino(
      {
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
      },
      devStream,
    )
  : pino({
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
    });
