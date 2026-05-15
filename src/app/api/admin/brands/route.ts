import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { brandUpsertSchema } from '@/lib/brand/types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const user = await requireUser();

  const brands = await db.brand.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: 'asc' }],
    include: { _count: { select: { eventTypes: true } } },
  });

  const owner = await db.user.findUnique({
    where: { id: user.id },
    select: { defaultBrandId: true },
  });

  return NextResponse.json(
    brands.map((b) => ({
      id: b.id,
      name: b.name,
      primaryColor: b.primaryColor,
      accentColor: b.accentColor,
      logoPath: b.logoPath,
      faviconPath: b.faviconPath,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
      isDefault: owner?.defaultBrandId === b.id,
      attachedEventTypes: b._count.eventTypes,
    })),
  );
}

async function postHandler(req: NextRequest): Promise<Response> {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = brandUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const brand = await db.brand.create({
    data: {
      userId: user.id,
      name: parsed.data.name,
      primaryColor: parsed.data.primaryColor,
      accentColor: parsed.data.accentColor,
    },
  });

  logger.info({ event: 'brand.created', userId: user.id, brandId: brand.id }, 'brand created');

  return NextResponse.json({ id: brand.id }, { status: 201 });
}

export const POST = csrf(postHandler);
