/**
 * POST /api/admin/event-types/one-time
 *
 * One-shot composition that creates a hidden + invite-only EventType AND
 * mints the BookingInvite that consumes it — the typical "send a single
 * person a calendar link with no public discoverability" flow.
 *
 * Slug is auto-generated (`ot-<random>`) so the admin doesn't have to think
 * about it; the slug is functionally unreachable anyway because `inviteOnly`
 * 404s the public slug route — only `/i/<token>` resolves.
 *
 * The raw token is surfaced exactly once in this response (same contract as
 * the per-event-type invite POST). After that, only the URL the admin saved
 * can be used.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { generateToken } from '@/lib/crypto';
import { getPublicUrl } from '@/lib/site-url/store';

export const dynamic = 'force-dynamic';

const oneTimeSchema = z.object({
  title: z.string().trim().min(1).max(100),
  durationMinutes: z.number().int().positive().max(1440).default(30),
  destinationAccountId: z.string().min(1),
  destinationCalendarId: z.string().min(1),
  scheduleId: z.string().optional(),
  hiddenGuests: z
    .array(z.string().trim().toLowerCase().email().max(320))
    .max(20)
    .optional(),
  note: z.string().trim().max(200).optional(),
  expiresAt: z.string().datetime().optional(),
});

function canonicalizeEmails(emails: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const e = raw.trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

// url-safe random suffix using crypto.randomBytes — lowercase alphanumeric
// only so it matches the existing slug regex.
function randomSlugSuffix(bytes = 6): string {
  // base32-ish: take random bytes, map to [0-9a-z]. 6 bytes -> 8 chars.
  return randomBytes(bytes)
    .toString('base64')
    .replace(/[+/=]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)
    .padEnd(8, '0');
}

async function pickFreeSlug(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `ot-${randomSlugSuffix()}`;
    const taken = await db.eventType.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Vanishingly unlikely — 8 attempts × 36^8 keyspace. Fail loudly if it happens.
  throw new Error('Could not allocate a free one-time slug');
}

async function postHandler(req: NextRequest): Promise<Response> {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = oneTimeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // Validate destination — same shape the regular createEventType uses.
  const calendar = await db.calendar.findUnique({
    where: { id: input.destinationCalendarId },
    select: { id: true, connectedAccountId: true, isDestinationEligible: true },
  });
  if (!calendar) {
    return NextResponse.json({ error: 'Destination calendar not found' }, { status: 400 });
  }
  if (calendar.connectedAccountId !== input.destinationAccountId) {
    return NextResponse.json(
      { error: 'Destination calendar does not belong to the specified account' },
      { status: 400 },
    );
  }
  if (!calendar.isDestinationEligible) {
    return NextResponse.json(
      { error: 'Destination calendar is not enabled as a destination.' },
      { status: 400 },
    );
  }

  // Pick a schedule: explicit > default. If neither, the booking flow will
  // simply produce no slots — same as the regular create path.
  let scheduleId: string | null = input.scheduleId ?? null;
  if (!scheduleId) {
    const def = await db.schedule.findFirst({
      where: { userId: user.id, isDefault: true },
      select: { id: true },
    });
    scheduleId = def?.id ?? null;
  } else {
    const owned = await db.schedule.findFirst({
      where: { id: scheduleId, userId: user.id },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 400 });
    }
  }

  const slug = await pickFreeSlug();
  const hiddenGuests = canonicalizeEmails(input.hiddenGuests);
  const { token: rawToken, hash: tokenHash } = generateToken(32);

  const { eventType, invite } = await db.$transaction(async (tx) => {
    const et = await tx.eventType.create({
      data: {
        userId: user.id,
        title: input.title,
        slug,
        color: '#4F6CFF',
        hidden: true,
        inviteOnly: true,
        isOneTime: true,
        durationMinutes: input.durationMinutes,
        destinationAccountId: input.destinationAccountId,
        destinationCalendarId: input.destinationCalendarId,
        locationKind: 'google_meet',
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
        minNoticeMin: 60,
        bookingWindowDays: 60,
        maxGuests: 3,
        slotIntervalMin: 15,
        scheduleId,
        sendReminders: true,
        hiddenGuestsJson: JSON.stringify(hiddenGuests),
        position: 0,
        archived: false,
      },
    });
    const inv = await tx.bookingInvite.create({
      data: {
        eventTypeId: et.id,
        tokenHash,
        note: input.note ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        hiddenGuestsJson: '[]', // event-type defaults already carry the cc list
      },
    });
    return { eventType: et, invite: inv };
  });

  const base = await getPublicUrl();
  return NextResponse.json(
    {
      eventTypeId: eventType.id,
      slug: eventType.slug,
      inviteId: invite.id,
      token: rawToken,
      url: `${base}/i/${rawToken}`,
      expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
    },
    { status: 201 },
  );
}

export const POST = csrf(postHandler);
