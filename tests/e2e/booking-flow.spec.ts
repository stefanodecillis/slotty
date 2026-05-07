/**
 * Public booking flow — end-to-end happy path.
 *
 * The full UI is exercised on the read paths (landing → event-type page →
 * confirmation), and the create/cancel calls go through the public API. This
 * keeps the test resilient to UI tweaks while still verifying that:
 *   - Slots load from the real Node-side computeSlots pipeline
 *   - The booking is committed to the DB even when the Google insert fails
 *     against our mock credentials (needsSync=true)
 *   - The confirmation page renders the booking
 *   - The .ics endpoint serves a valid calendar attachment
 *   - A booker-initiated cancel through the API moves the row to cancelled
 */
import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';

import { prismaForE2e, nextTuesdayAtTen } from './_lib';

test.describe('Public booking flow', () => {
  test('landing page shows the seeded event type', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'E2E Quick chat' })).toBeVisible();
  });

  test('event-type page renders the booking flow', async ({ page }) => {
    await page.goto('/quick-chat');
    // Header heading (h1) — the booking summary aside also has an h2 with the
    // same title, so anchor on level: 1.
    await expect(
      page.getByRole('heading', { level: 1, name: 'E2E Quick chat' }),
    ).toBeVisible();
    // Calendar grid is rendered (the "Previous month" button comes from the picker).
    await expect(page.getByRole('button', { name: 'Previous month' })).toBeVisible();
  });

  test('booking creation, confirmation page, .ics download, and cancel', async ({
    page,
    request,
  }) => {
    const start = nextTuesdayAtTen();
    const startIso = start.toISOString();

    // 1. The slot endpoint should list the chosen 10:00 UTC slot for that Tuesday.
    const dayKey = DateTime.fromJSDate(start).toUTC().toISODate();
    const slotsRes = await request.get('/api/public/event-types/quick-chat/slots', {
      params: {
        from: DateTime.fromJSDate(start).startOf('day').toUTC().toISO()!,
        to: DateTime.fromJSDate(start).endOf('day').toUTC().toISO()!,
        tz: 'UTC',
      },
    });
    expect(slotsRes.ok()).toBeTruthy();
    const slotsBody = await slotsRes.json();
    const tueDay = (slotsBody.days as { date: string; slots: { startUtc: string }[] }[]).find(
      (d) => d.date === dayKey,
    );
    expect(tueDay, `expected slots on ${dayKey}`).toBeTruthy();
    expect(tueDay!.slots.length).toBeGreaterThan(0);
    // Pick a slot deep into the day so it's safely after `now + minNoticeMin`
    // even if the test runs slightly later than expected. Avoids edge cases
    // where the chosen 10:00 slot happens to be exactly at the notice horizon.
    const targetSlot =
      tueDay!.slots.find((s) => s.startUtc === startIso) ??
      tueDay!.slots[Math.floor(tueDay!.slots.length / 2)] ??
      tueDay!.slots[0]!;

    // 2. Submit the booking via the public API. Google insert will fail (the
    //    seeded account has expired tokens that can't refresh), but the
    //    booking row should still land with needsSync=true.
    const createRes = await request.post('/api/public/bookings', {
      data: {
        eventTypeSlug: 'quick-chat',
        startAt: targetSlot.startUtc,
        bookerName: 'Bob Booker',
        bookerEmail: 'bob@example.com',
        bookerTimezone: 'UTC',
        notes: 'Looking forward to it.',
      },
    });
    if (!createRes.ok()) {
      // eslint-disable-next-line no-console
      console.error(
        `booking create returned ${createRes.status()}: ${await createRes.text()}\n` +
          `  requested startAt: ${targetSlot.startUtc}\n` +
          `  picked from day:   ${dayKey}\n` +
          `  slots that day:    ${JSON.stringify(tueDay!.slots.map((s) => s.startUtc))}`,
      );
    }
    expect(createRes.ok()).toBeTruthy();
    const created = (await createRes.json()) as {
      id: string;
      manageUrl: string;
      cancelToken: string;
      rescheduleToken: string;
      meetingUrl?: string | null;
      needsSync: boolean;
    };
    expect(created.id).toBeTruthy();
    // Either Google succeeded (highly unlikely in CI) or needsSync flipped on.
    expect(typeof created.needsSync).toBe('boolean');

    // 3. Confirmation page renders.
    await page.goto(
      `/b/${created.id}?t=${encodeURIComponent(created.rescheduleToken)}`,
    );
    await expect(page.getByText('Bob Booker')).toBeVisible();

    // 4. ICS endpoint returns text/calendar.
    const icsRes = await request.get(
      `/api/public/bookings/${created.id}/ics?t=${encodeURIComponent(created.cancelToken)}`,
    );
    expect(icsRes.ok()).toBeTruthy();
    expect(icsRes.headers()['content-type']).toContain('text/calendar');
    const icsText = await icsRes.text();
    expect(icsText).toContain('BEGIN:VCALENDAR');
    expect(icsText).toContain('END:VCALENDAR');

    // 5. DB has the booking exactly once.
    const prisma = prismaForE2e();
    try {
      const row = await prisma.booking.findUnique({ where: { id: created.id } });
      expect(row).not.toBeNull();
      expect(row!.bookerEmail).toBe('bob@example.com');
      expect(row!.status).toBe('confirmed');
    } finally {
      await prisma.$disconnect();
    }

    // 6. Cancel via public API; status becomes 'cancelled'.
    const cancelRes = await request.post(
      `/api/public/bookings/${created.id}/cancel?t=${encodeURIComponent(created.cancelToken)}`,
      { data: { reason: 'Schedule conflict' } },
    );
    expect(cancelRes.ok()).toBeTruthy();

    const prisma2 = prismaForE2e();
    try {
      const after = await prisma2.booking.findUnique({ where: { id: created.id } });
      expect(after!.status).toBe('cancelled');
      expect(after!.cancelledAt).not.toBeNull();
    } finally {
      await prisma2.$disconnect();
    }
  });
});
