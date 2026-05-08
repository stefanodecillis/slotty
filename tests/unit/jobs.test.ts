/**
 * Job scheduler unit tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { db } from '@/lib/db';
import {
  registerHandler,
  enqueueJob,
  runJobNow,
  tick,
  _resetForTests,
  getRegisteredKinds,
} from '@/lib/jobs/scheduler';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function clearJobs() {
  await db.job.deleteMany({});
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('job scheduler', () => {
  beforeEach(async () => {
    _resetForTests();
    await clearJobs();
  });

  afterEach(async () => {
    _resetForTests();
    await clearJobs();
  });

  it('registers a handler and runs it when a job is enqueued', async () => {
    let ran = false;

    registerHandler('test_job', async () => {
      ran = true;
    });

    const jobId = await enqueueJob('test_job', {}, new Date(Date.now() - 1));
    await runJobNow(jobId);

    expect(ran).toBe(true);

    const job = await db.job.findUnique({ where: { id: jobId } });
    expect(job?.status).toBe('done');
  });

  it('marks a failed job as pending with backoff on first failure', async () => {
    registerHandler(
      'fail_once',
      async (_payload, ctx) => {
        if (ctx.attempts === 1) throw new Error('temporary failure');
      },
      { maxAttempts: 3, retryOnError: true },
    );

    const jobId = await enqueueJob('fail_once', {}, new Date(Date.now() - 1));
    await runJobNow(jobId);

    const job = await db.job.findUnique({ where: { id: jobId } });
    // On first failure with retryOnError, should be back to pending.
    expect(job?.status).toBe('pending');
    expect(job?.lastError).toBeTruthy();
    // runAt should be in the future (backoff applied).
    expect(job!.runAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('permanently fails a job after maxAttempts is reached', async () => {
    registerHandler(
      'always_fail',
      async () => {
        throw new Error('always fails');
      },
      { maxAttempts: 1, retryOnError: false },
    );

    const jobId = await enqueueJob('always_fail', {}, new Date(Date.now() - 1));
    await runJobNow(jobId);

    const job = await db.job.findUnique({ where: { id: jobId } });
    expect(job?.status).toBe('failed');
    expect(job?.lastError).toContain('always fails');
  });

  it('picks up due jobs in tick()', async () => {
    const results: string[] = [];

    registerHandler('ping', async (payload) => {
      results.push((payload as { msg: string }).msg);
    });

    // One past-due job.
    await enqueueJob('ping', { msg: 'hello' }, new Date(Date.now() - 1000));

    const count = await tick();

    expect(count).toBeGreaterThanOrEqual(1);
    expect(results).toContain('hello');
  });

  it('does not run a job scheduled in the future', async () => {
    let ran = false;

    registerHandler('future_job', async () => {
      ran = true;
    });

    // Schedule 1 hour in the future.
    await enqueueJob('future_job', {}, new Date(Date.now() + 3_600_000));
    await tick();

    expect(ran).toBe(false);
  });
});

// ─── Daily backup job tests ───────────────────────────────────────────────────
//
// Use an isolated tmp `root` so we never touch the repo's real `data/` or
// `backups/` directories. `runDailyBackup({ root })` reads from
// `<root>/data/slotty.db` and writes to `<root>/backups/`.

describe('daily backup job', () => {
  let testRoot: string;
  let dbPath: string;
  let backupsDir: string;

  beforeEach(() => {
    testRoot = join(tmpdir(), `slotty-backup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testRoot, 'data'), { recursive: true });
    dbPath = join(testRoot, 'data', 'slotty.db');
    backupsDir = join(testRoot, 'backups');
    // Stub DB file with deterministic content so we can verify byte-for-byte copy.
    writeFileSync(dbPath, 'SQLITE-STUB-BYTES');
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('runDailyBackup creates a .db file in backups/', async () => {
    const { runDailyBackup } = await import('@/lib/jobs/backup');

    await runDailyBackup({ root: testRoot });

    const created = readdirSync(backupsDir).filter((f) => f.endsWith('.db'));
    expect(created.length).toBe(1);
    expect(created[0]).toMatch(/^slotty-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/);
  });

  it('runDailyBackup prunes backups exceeding retention', async () => {
    const { runDailyBackup } = await import('@/lib/jobs/backup');

    mkdirSync(backupsDir, { recursive: true });

    // Create 8 fake old daily backups dated Jan 1–8, 2020. Retention keeps
    // the 7 most-recent dailies + one weekly, so the oldest must be pruned.
    const pad = (n: number) => String(n).padStart(2, '0');
    for (let i = 0; i < 8; i++) {
      const d = new Date(2020, 0, i + 1, 3, 0, 0);
      const name = `slotty-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.db`;
      writeFileSync(join(backupsDir, name), '');
    }

    await runDailyBackup({ root: testRoot });

    // TODO(user): write 5–8 lines that assert the *retention contract*:
    //   - today's backup was created (matches `slotty-<YYYY-MM-DD>T...db`);
    //   - we keep the 7 most-recent dailies (the 7 newest from 2020 plus today
    //     would normally be 8, but oldest 2020 entry is pruned);
    //   - exactly one of the 2020 files was deleted (`slotty-2020-01-01T...db`).
    //
    // Trade-off to consider: a strict `expect(remaining).toEqual([...])` is
    // precise but couples tests to retention math; a looser `expect(...length)`
    // check is more resilient if KEEP_DAILY/KEEP_WEEKLY change. Pick whichever
    // matches how stable you expect that policy to be. The `remaining` array
    // is sorted alphabetically — wrap in `.sort()` for deterministic order.
    const remaining = readdirSync(backupsDir).filter((f) => f.endsWith('.db')).sort();
    expect(remaining.length).toBeGreaterThan(0); // placeholder
  });
});
