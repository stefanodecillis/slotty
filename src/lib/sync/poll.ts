/**
 * Fallback poller. Runs every 10 minutes and walks every calendar marked as
 * a busy source on an active account. The push channels usually beat us to
 * the punch; this loop catches anything we missed (channel expired, webhook
 * dropped, etc.). Errors are logged per-calendar — never thrown — so a single
 * misbehaving calendar can't take down the entire sweep.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

import { syncCalendarIncremental } from './incremental';

export interface PollSummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

export async function pollAllCalendars(): Promise<PollSummary> {
  const calendars = await db.calendar.findMany({
    where: {
      isBusySource: true,
      connectedAccount: { status: 'active' },
    },
    select: { id: true },
  });

  let succeeded = 0;
  let failed = 0;
  for (const cal of calendars) {
    try {
      await syncCalendarIncremental(cal.id);
      succeeded += 1;
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { event: 'sync.poll.calendar_failed', calendarId: cal.id, err: msg },
        'poll: calendar sync failed',
      );
      try {
        const cal2 = await db.calendar.findUnique({
          where: { id: cal.id },
          select: { connectedAccountId: true },
        });
        if (cal2) {
          await db.connectedAccount.update({
            where: { id: cal2.connectedAccountId },
            data: { lastSyncError: msg.slice(0, 500) },
          });
        }
      } catch {
        /* swallow */
      }
    }
  }

  logger.info(
    {
      event: 'sync.poll.completed',
      attempted: calendars.length,
      succeeded,
      failed,
    },
    'poll sweep complete',
  );

  return { attempted: calendars.length, succeeded, failed };
}
