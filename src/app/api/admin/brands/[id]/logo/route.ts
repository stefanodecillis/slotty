import { NextRequest, NextResponse } from 'next/server';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateOrigin } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { isAllowedImageType } from '@/lib/brand/image-validate';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB — logos can be bigger than avatars
const TARGET_SIZE = 512;

type RouteContext = { params: { id: string } };

export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  if (!validateOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const brand = await db.brand.findUnique({ where: { id: params.id } });
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('logo');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'File too large. Maximum size is 2 MB.' }, { status: 400 });
  }

  const rawBuffer = await file.arrayBuffer();
  const rawBytes = new Uint8Array(rawBuffer);

  if (!isAllowedImageType(rawBytes)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Allowed: JPEG, PNG, WebP, GIF.' },
      { status: 400 },
    );
  }

  const sharp = (await import('sharp')).default;

  let webpBuffer: Buffer;
  try {
    // Square cover crop — the client cropper already produces a square Blob,
    // but we still re-encode + EXIF-strip server-side as defense in depth.
    webpBuffer = await sharp(rawBuffer)
      .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'cover', position: 'centre' })
      .toFormat('webp', { effort: 6 })
      .toBuffer();
  } catch (err) {
    logger.error({ event: 'brand.logo.encode_error', userId: user.id, brandId: brand.id, err }, 'sharp encode failed');
    return NextResponse.json({ error: 'Failed to process image.' }, { status: 422 });
  }

  const dir = join(process.cwd(), 'data', 'brand-logos');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const filename = `${brand.id}.webp`;
  await writeFile(join(dir, filename), webpBuffer);

  const logoPath = `/brand-assets/logos/${filename}`;
  await db.brand.update({ where: { id: brand.id }, data: { logoPath } });

  logger.info({ event: 'brand.logo.updated', userId: user.id, brandId: brand.id }, 'brand logo updated');

  return NextResponse.json({ logoPath }, { status: 200 });
}
