/**
 * Next.js instrumentation hook — runs once on server startup.
 *
 * Validates env on boot, then starts the in-process job scheduler.
 * Uses a global flag to prevent double-start in dev hot-reload.
 */

declare global {
  // eslint-disable-next-line no-var
  var __slotty_scheduler_started__: boolean | undefined;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { env } = await import('@/lib/env');
  const { logger } = await import('@/lib/logger');

  // Touch a required field; throws if env is invalid.
  void env.SLOTTY_PUBLIC_URL;

  logger.info({ url: env.SLOTTY_PUBLIC_URL, level: env.SLOTTY_LOG_LEVEL }, 'slotty starting');

  // Guard against double-start in dev hot-reload.
  if (globalThis.__slotty_scheduler_started__) {
    logger.debug({ event: 'scheduler.skip_start' }, 'scheduler already started in this process');
    return;
  }
  globalThis.__slotty_scheduler_started__ = true;

  const { startJobScheduler } = await import('@/lib/jobs/scheduler');
  await startJobScheduler();
}
