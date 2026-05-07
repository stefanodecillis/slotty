import { type NextRequest, NextResponse } from 'next/server';
import { validateOrigin } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { deleteSchedule } from '@/lib/availability/schedule';
import { timezoneSchema } from '@/lib/availability/validators';
import { db } from '@/lib/db';
import { z } from 'zod';

const patchBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: timezoneSchema.optional(),
});

type RouteContext = { params: { id: string } };

async function verifyOwnership(scheduleId: string, userId: string) {
  return db.schedule.findFirst({ where: { id: scheduleId, userId } });
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  if (!validateOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const schedule = await verifyOwnership(params.id, user.id);
  if (!schedule) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 422 });
  }

  const updated = await db.schedule.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.timezone !== undefined ? { timezone: parsed.data.timezone } : {}),
    },
    include: { rules: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] } },
  });

  return NextResponse.json({ schedule: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  if (!validateOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const schedule = await verifyOwnership(params.id, user.id);
  if (!schedule) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  try {
    await deleteSchedule(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
