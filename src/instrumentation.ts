/**
 * Next.js instrumentation hook — runs once on server startup.
 *
 * In Phase 0 we just touch env validation so the process fails fast if
 * required vars are missing or weak. Later phases will start the in-process
 * job worker, hydrate the M3 token cache from User.seedColor, etc.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { env } = await import('@/lib/env');
  const { logger } = await import('@/lib/logger');

  // Touch a required field; throws if env is invalid.
  void env.SLOTTY_PUBLIC_URL;

  logger.info({ url: env.SLOTTY_PUBLIC_URL, level: env.SLOTTY_LOG_LEVEL }, 'slotty starting');
}
