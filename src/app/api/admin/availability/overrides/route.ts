import { type NextRequest, NextResponse } from 'next/server';
import { validateOrigin } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { setDateOverride, removeDateOverride } from '@/lib/availability/overrides';
import { db } from '@/lib/db';
import { z } from 'zod';

const upsertBodySchema = z.object({
  scheduleId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  isBlocked: z.boolean(),
  startMinute: z.number().int().min(0).max(1439).optional(),
  endMinute: z.number().int().min(1).max(1440).optional(),
  label: z.string().max(255).optional(),
});

const deleteBodySchema = z.object({
  scheduleId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

async function verifyScheduleOwnership(scheduleId: string, userId: string) {
  const schedule = await db.schedule.findFirst({
    where: { id: scheduleId, userId },
  });
  return schedule;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!validateOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = upsertBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 422 });
  }

  const { scheduleId, date, isBlocked, startMinute, endMinute, label } = parsed.data;

  const schedule = await verifyScheduleOwnership(scheduleId, user.id);
  if (!schedule) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  try {
    const override = await setDateOverride(scheduleId, new Date(`${date}T00:00:00Z`), {
      isBlocked,
      startMinute,
      endMinute,
      label,
    });
    return NextResponse.json({ override });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  if (!validateOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = deleteBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 422 });
  }

  const { scheduleId, date } = parsed.data;

  const schedule = await verifyScheduleOwnership(scheduleId, user.id);
  if (!schedule) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  await removeDateOverride(scheduleId, new Date(`${date}T00:00:00Z`));
  return NextResponse.json({ ok: true });
}
