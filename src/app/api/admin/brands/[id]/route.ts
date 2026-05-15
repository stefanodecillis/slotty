import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { brandUpsertSchema } from '@/lib/brand/types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

async function loadOwnedBrand(brandId: string, userId: string) {
  const brand = await db.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.userId !== userId) return null;
  return brand;
}

export async function GET(_req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();
  const brand = await loadOwnedBrand(params.id, user.id);
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const attached = await db.eventType.count({ where: { brandId: brand.id } });

  return NextResponse.json({
    id: brand.id,
    name: brand.name,
    primaryColor: brand.primaryColor,
    accentColor: brand.accentColor,
    logoPath: brand.logoPath,
    faviconPath: brand.faviconPath,
    attachedEventTypes: attached,
  });
}

async function putHandler(req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();
  const brand = await loadOwnedBrand(params.id, user.id);
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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

  await db.brand.update({
    where: { id: brand.id },
    data: {
      name: parsed.data.name,
      primaryColor: parsed.data.primaryColor,
      accentColor: parsed.data.accentColor,
    },
  });

  return NextResponse.json({ id: brand.id });
}

async function deleteHandler(_req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();
  const brand = await loadOwnedBrand(params.id, user.id);
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Clear default-brand pointer if this is the user's default.
  await db.$transaction([
    db.user.updateMany({
      where: { id: user.id, defaultBrandId: brand.id },
      data: { defaultBrandId: null },
    }),
    db.brand.delete({ where: { id: brand.id } }),
  ]);

  // Best-effort cleanup of stored assets — DB write already committed, so a
  // missing file here doesn't matter; we just log and move on.
  for (const path of [brand.logoPath, brand.faviconPath]) {
    if (!path) continue;
    const base = path.split('/').pop();
    if (!base) continue;
    const dir = path.includes('/brand-assets/logos/') ? 'brand-logos' : 'brand-favicons';
    try {
      await unlink(join(process.cwd(), 'data', dir, base));
    } catch (err) {
      logger.warn({ event: 'brand.asset_unlink_failed', userId: user.id, brandId: brand.id, err }, 'brand asset unlink failed');
    }
  }

  logger.info({ event: 'brand.deleted', userId: user.id, brandId: brand.id }, 'brand deleted');

  return NextResponse.json({ ok: true });
}

export const PUT = csrf(putHandler);
export const DELETE = csrf(deleteHandler);
