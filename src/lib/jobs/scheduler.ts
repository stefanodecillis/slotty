/**
 * In-process job scheduler. The DB-backed `Job` table is the source of truth
 * for "what needs to run when"; this module provides:
 *
 *   - A handler registry: `registerHandler(kind, fn)`
 *   - An enqueue helper: `enqueueJob(kind, payload, runAt)`
 *   - A poll loop: `runScheduler()` — picks pending jobs whose `runAt` has
 *     passed, marks them `running`, invokes the handler, transitions to
 *     `done` or `failed`. With exponential backoff on retry up to
 *     `maxAttempts` (default 3).
 *   - Cron-like recurring schedules registered via `scheduleRecurring(...)`.
 *
 * Phase 2 builds the bigger version of this module; Phase 3 contributes its
 * job kinds. Both can extend the same registry — last write wins for a given
 * `kind`. The scheduler is opt-in: callers must explicitly invoke
 * `startJobScheduler()` from instrumentation.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface JobContext {
  jobId: string;
  attempts: number;
}

export type JobHandler<P = unknown> = (payload: P, ctx: JobContext) => Promise<void>;

export interface JobOptions {
  maxAttempts?: number;
  /** Whether errors marked `transient` should be retried with backoff. */
  retryOnError?: boolean;
}

interface RegisteredHandler {
  fn: JobHandler;
  options: Required<JobOptions>;
}

const handlers = new Map<string, RegisteredHandler>();

const DEFAULT_OPTIONS: Required<JobOptions> = {
  maxAttempts: 3,
  retryOnError: true,
};

export function registerHandler<P = unknown>(
  kind: string,
  fn: JobHandler<P>,
  options: JobOptions = {},
): void {
  handlers.set(kind, {
    fn: fn as JobHandler,
    options: { ...DEFAULT_OPTIONS, ...options },
  });
}

export function unregisterHandler(kind: string): void {
  handlers.delete(kind);
}

export function getRegisteredKinds(): string[] {
  return Array.from(handlers.keys());
}

/**
 * Enqueue a job for execution at `runAt` (defaults to "now"). Returns the
 * created Job id.
 */
export async function enqueueJob<P = unknown>(
  kind: string,
  payload: P = {} as P,
  runAt: Date = new Date(),
): Promise<string> {
  const job = await db.job.create({
    data: {
      kind,
      payloadJson: JSON.stringify(payload ?? {}),
      runAt,
    },
  });
  return job.id;
}

/**
 * Run a single job in-process by id (test helper). Bypasses the polling loop
 * but uses the same handler / retry / backoff logic.
 */
export async function runJobNow(jobId: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`Job not found: ${jobId}`);
  await executeJob(job);
}

interface JobRow {
  id: string;
  kind: string;
  payloadJson: string;
  attempts: number;
}

async function executeJob(job: JobRow): Promise<void> {
  const handler = handlers.get(job.kind);
  if (!handler) {
    logger.warn({ event: 'jobs.no_handler', kind: job.kind, jobId: job.id }, 'no handler registered');
    await db.job.update({
      where: { id: job.id },
      data: { status: 'failed', lastError: `no handler for kind ${job.kind}` },
    });
    return;
  }

  await db.job.update({
    where: { id: job.id },
    data: { status: 'running', attempts: { increment: 1 } },
  });

  let payload: unknown;
  try {
    payload = JSON.parse(job.payloadJson || '{}');
  } catch {
    payload = {};
  }

  try {
    await handler.fn(payload, { jobId: job.id, attempts: job.attempts + 1 });
    await db.job.update({
      where: { id: job.id },
      data: { status: 'done', lastError: null },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const attempts = job.attempts + 1;
    const shouldRetry = handler.options.retryOnError && attempts < handler.options.maxAttempts;

    if (shouldRetry) {
      const backoffMs = backoffDelay(attempts);
      const runAt = new Date(Date.now() + backoffMs);
      await db.job.update({
        where: { id: job.id },
        data: { status: 'pending', runAt, lastError: errMsg },
      });
      logger.warn(
        { event: 'jobs.retry', kind: job.kind, jobId: job.id, attempts, backoffMs },
        'job failed, scheduling retry',
      );
    } else {
      await db.job.update({
        where: { id: job.id },
        data: { status: 'failed', lastError: errMsg },
      });
      logger.error(
        { event: 'jobs.failed', kind: job.kind, jobId: job.id, attempts, err: errMsg },
        'job failed permanently',
      );
    }
  }
}

function backoffDelay(attempt: number): number {
  // 1s, 4s, 16s, 64s, … capped at 5 minutes.
  return Math.min(1000 * Math.pow(4, attempt - 1), 5 * 60 * 1000);
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
const recurring: Array<{ kind: string; intervalMs: number; lastRun: number }> = [];

/**
 * Start the in-process polling loop. Idempotent — repeated calls are no-ops.
 * Pass `intervalMs` to override the default 5s tick.
 */
export function runScheduler(intervalMs = 5000): void {
  if (pollHandle) return;
  pollHandle = setInterval(() => {
    void tick().catch((err) => {
      logger.error({ event: 'jobs.tick_error', err: String(err) }, 'scheduler tick failed');
    });
  }, intervalMs);
}

export function stopScheduler(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

/** Run pending jobs whose runAt has passed. Returns the number processed. */
export async function tick(): Promise<number> {
  const now = new Date();

  // Recurring schedules — enqueue if interval elapsed.
  for (const r of recurring) {
    if (now.getTime() - r.lastRun >= r.intervalMs) {
      r.lastRun = now.getTime();
      // Best-effort dedupe: skip if there's already a pending job of this kind.
      const existing = await db.job.findFirst({
        where: { kind: r.kind, status: 'pending' },
      });
      if (!existing) {
        await enqueueJob(r.kind, {}, now);
      }
    }
  }

  const due = await db.job.findMany({
    where: { status: 'pending', runAt: { lte: now } },
    orderBy: { runAt: 'asc' },
    take: 25,
  });

  for (const job of due) {
    await executeJob(job);
  }
  return due.length;
}

/**
 * Register a recurring kind. The scheduler enqueues a job of `kind` at most
 * once per `intervalMs`. Combine with `registerHandler(kind, ...)` to wire
 * actual work.
 */
export function scheduleRecurring(kind: string, intervalMs: number): void {
  // Replace any existing entry with the same kind.
  const idx = recurring.findIndex((r) => r.kind === kind);
  if (idx >= 0) {
    recurring.splice(idx, 1);
  }
  recurring.push({ kind, intervalMs, lastRun: 0 });
}

export function getRecurringSchedules(): ReadonlyArray<{ kind: string; intervalMs: number }> {
  return recurring.map((r) => ({ kind: r.kind, intervalMs: r.intervalMs }));
}

/** Test helper: clear all handlers and recurring schedules. */
export function _resetForTests(): void {
  handlers.clear();
  recurring.length = 0;
  stopScheduler();
}

// ─── Startup helper ──────────────────────────────────────────────────────────

/** Next 03:00 UTC from now. */
function nextDailyBackupTime(): Date {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0, 0));
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

async function ensureDailyBackupJob(): Promise<void> {
  const existing = await db.job.findFirst({
    where: {
      kind: 'daily_backup',
      status: { in: ['pending', 'running'] },
    },
  });

  if (!existing) {
    const runAt = nextDailyBackupTime();
    await db.job.create({
      data: { kind: 'daily_backup', runAt, payloadJson: '{}', status: 'pending' },
    });
    logger.info({ event: 'scheduler.job_queued', kind: 'daily_backup', runAt }, 'queued daily_backup');
  }
}

/**
 * Start the job scheduler with all built-in jobs registered.
 * Idempotent — safe to call multiple times (dev hot-reload).
 */
export async function startJobScheduler(): Promise<void> {
  // Register built-in handlers. The backup module uses node:fs/path/child_process,
  // all of which are externalized via next.config.mjs's node:* rule, so a plain
  // dynamic import works in both dev (Turbopack/webpack) and prod (standalone).
  registerHandler('daily_backup', async () => {
    const { runDailyBackup } = await import('@/lib/jobs/backup');
    await runDailyBackup();
    // Reschedule for the next day after completion.
    const runAt = nextDailyBackupTime();
    await db.job.create({
      data: { kind: 'daily_backup', runAt, payloadJson: '{}', status: 'pending' },
    });
    logger.info({ event: 'scheduler.daily_backup_rescheduled', runAt }, 'daily backup rescheduled');
  });

  // Ensure initial backup job is queued.
  try {
    await ensureDailyBackupJob();
  } catch (err) {
    logger.error({ event: 'scheduler.init_error', err }, 'failed to ensure initial jobs');
  }

  try {
    const { registerSyncJobs } = await import('@/lib/sync/jobs');
    registerSyncJobs();
  } catch (err) {
    logger.error({ event: 'scheduler.sync_jobs_init_error', err }, 'failed to register sync jobs');
  }

  try {
    const { registerWebhookDeliveryHandler } = await import('@/lib/webhooks/deliver');
    registerWebhookDeliveryHandler();
  } catch (err) {
    logger.error({ event: 'scheduler.webhook_handler_init_error', err }, 'failed to register webhook handler');
  }

  // Daily retention sweep — drops invites that are used/revoked/expired
  // beyond the retention window plus any orphan one-time EventTypes.
  registerHandler('prune_booking_invites', async () => {
    const { pruneOldBookingInvites } = await import('@/lib/jobs/prune-invites');
    await pruneOldBookingInvites();
  }, { maxAttempts: 3, retryOnError: true });
  scheduleRecurring('prune_booking_invites', 24 * 60 * 60 * 1000);

  runScheduler(5_000);
  logger.info({ event: 'scheduler.started' }, 'job scheduler started');
}
