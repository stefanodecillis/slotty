import { type NextRequest, NextResponse } from 'next/server';
import { validateOrigin } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { importHolidaysFromIcal } from '@/lib/availability/holidays';
import { db } from '@/lib/db';
import { z } from 'zod';

const bodySchema = z.object({
  scheduleId: z.string().min(1),
  icalUrl: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
});

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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 422 });
  }

  const { scheduleId, icalUrl, year } = parsed.data;

  // Verify schedule ownership
  const schedule = await db.schedule.findFirst({
    where: { id: scheduleId, userId: user.id },
  });
  if (!schedule) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  try {
    const result = await importHolidaysFromIcal(scheduleId, icalUrl, year);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
