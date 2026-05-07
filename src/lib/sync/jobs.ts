/**
 * Bridge between the Phase 2 job scheduler and Phase 3 sync engine.
 *
 * Call `registerSyncJobs()` once at startup to wire up:
 *   - `incremental_sync` — single calendar pull (fired by webhook + manual resync)
 *   - `renew_watch_channels` — daily, refreshes push channels nearing expiry
 *   - `poll_calendars` — fallback every 10 min in case a webhook is missed
 *
 * `incremental_sync` retries up to 3 times on transient errors with the
 * scheduler's built-in exponential backoff.
 */
import { registerHandler, scheduleRecurring } from '@/lib/jobs/scheduler';
import { logger } from '@/lib/logger';

import { syncCalendarIncremental } from './incremental';
import { renewExpiringChannels } from './watch';
import { pollAllCalendars } from './poll';

const TEN_MIN_MS = 10 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface IncrementalPayload {
  calendarId: string;
}

export function registerSyncJobs(): void {
  registerHandler<IncrementalPayload>(
    'incremental_sync',
    async (payload) => {
      if (!payload?.calendarId) {
        throw new Error('incremental_sync requires { calendarId }');
      }
      await syncCalendarIncremental(payload.calendarId);
    },
    { maxAttempts: 3, retryOnError: true },
  );

  registerHandler('renew_watch_channels', async () => {
    await renewExpiringChannels();
  });

  registerHandler('poll_calendars', async () => {
    await pollAllCalendars();
  });

  scheduleRecurring('renew_watch_channels', ONE_DAY_MS);
  scheduleRecurring('poll_calendars', TEN_MIN_MS);

  logger.info({ event: 'sync.jobs_registered' }, 'sync job handlers registered');
}
