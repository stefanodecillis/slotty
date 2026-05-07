import { type NextRequest, NextResponse } from 'next/server';
import { validateOrigin } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { listSchedules, createSchedule } from '@/lib/availability/schedule';
import { timezoneSchema } from '@/lib/availability/validators';
import { z } from 'zod';

const createBodySchema = z.object({
  name: z.string().min(1).max(100),
  timezone: timezoneSchema,
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const schedules = await listSchedules(user.id);
  return NextResponse.json({ schedules });
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

  const parsed = createBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 422 });
  }

  const schedule = await createSchedule(user.id, parsed.data.name, parsed.data.timezone);
  return NextResponse.json({ schedule }, { status: 201 });
}
