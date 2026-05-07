import { z } from 'zod';

/**
 * App-wide environment validation. Imported by every entrypoint that needs
 * config. Throws on first import if required vars are missing or weak,
 * which is the desired "fail fast" behavior for a self-hosted deploy.
 */

const base64 = (minBytes: number) =>
  z
    .string()
    .min(1)
    .refine(
      (s) => {
        try {
          return Buffer.from(s, 'base64').length >= minBytes;
        } catch {
          return false;
        }
      },
      { message: `must be base64-encoded ≥${minBytes} bytes` },
    );

const url = z.string().url();
const truthy = z
  .union([z.string(), z.boolean()])
  .transform((v) => (typeof v === 'string' ? ['true', '1', 'yes', 'on'].includes(v.toLowerCase()) : v));

const schema = z.object({
  // Required core
  SLOTTY_PUBLIC_URL: url,
  SLOTTY_ENCRYPTION_KEY: base64(32),
  SLOTTY_SESSION_SECRET: z.string().min(32),
  SLOTTY_DATABASE_URL: z.string().min(1).default('file:../data/slotty.db'),

  // Google (optional at boot, required to use calendars)
  SLOTTY_GOOGLE_CLIENT_ID: z.string().optional(),
  SLOTTY_GOOGLE_CLIENT_SECRET: z.string().optional(),

  // SMTP (optional at boot, required to send mail)
  SLOTTY_SMTP_HOST: z.string().optional(),
  SLOTTY_SMTP_PORT: z.coerce.number().int().positive().optional(),
  SLOTTY_SMTP_USER: z.string().optional(),
  SLOTTY_SMTP_PASS: z.string().optional(),
  SLOTTY_SMTP_FROM: z.string().optional(),

  // Optional integrations
  SLOTTY_TURNSTILE_SITE_KEY: z.string().optional(),
  SLOTTY_TURNSTILE_SECRET: z.string().optional(),
  SLOTTY_SENTRY_DSN: z.string().optional(),

  // Behavior
  SLOTTY_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SLOTTY_TRUST_PROXY: truthy.default(true),

  // Node
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Use console.error here — this runs before logger is configured.
    console.error(`[slotty] Invalid environment:\n${issues}`);
    throw new Error('Invalid environment configuration. See errors above.');
  }
  return parsed.data;
}

/**
 * Lazy accessor so importing this module never throws unless env is read.
 * In server components and API routes, reading any property throws if
 * the env is invalid — exactly when we want to fail.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, key: string) {
    cached ??= load();
    return cached[key as keyof Env];
  },
});

export const features = {
  google: () => Boolean(env.SLOTTY_GOOGLE_CLIENT_ID && env.SLOTTY_GOOGLE_CLIENT_SECRET),
  smtp: () =>
    Boolean(env.SLOTTY_SMTP_HOST && env.SLOTTY_SMTP_PORT && env.SLOTTY_SMTP_FROM),
  turnstile: () => Boolean(env.SLOTTY_TURNSTILE_SITE_KEY && env.SLOTTY_TURNSTILE_SECRET),
  sentry: () => Boolean(env.SLOTTY_SENTRY_DSN),
};
