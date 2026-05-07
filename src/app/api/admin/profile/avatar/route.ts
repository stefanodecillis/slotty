import { NextRequest, NextResponse } from 'next/server';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateOrigin } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const MAX_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

/** Validate magic bytes for JPEG, PNG, WebP, GIF. */
function isAllowedImageType(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;

  // PNG: 89 50 4E 47
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return true;

  // GIF: 47 49 46 38
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  )
    return true;

  // WebP: RIFF????WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return true;

  return false;
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('avatar');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'File too large. Maximum size is 1 MB.' }, { status: 400 });
  }

  const rawBuffer = await file.arrayBuffer();
  const rawBytes = new Uint8Array(rawBuffer);

  // Magic byte validation
  if (!isAllowedImageType(rawBytes)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Allowed: JPEG, PNG, WebP, GIF.' },
      { status: 400 },
    );
  }

  // Lazy import sharp so the module isn't bundled in edge runtimes.
  const sharp = (await import('sharp')).default;

  let webpBuffer: Buffer;
  try {
    // Note: NOT calling .withMetadata() is what strips EXIF from the output.
    // Calling .withMetadata({}) with no arguments preserves input metadata,
    // so we intentionally omit it to ensure all EXIF data is removed.
    webpBuffer = await sharp(rawBuffer)
      .resize(256, 256, { fit: 'cover', position: 'attention' })
      .toFormat('webp', { effort: 6 })
      .toBuffer();
  } catch (err) {
    logger.error({ event: 'avatar.encode_error', userId: user.id, err }, 'sharp encode failed');
    return NextResponse.json({ error: 'Failed to process image.' }, { status: 422 });
  }

  // Ensure the avatars directory exists.
  const avatarsDir = join(process.cwd(), 'data', 'avatars');
  if (!existsSync(avatarsDir)) {
    mkdirSync(avatarsDir, { recursive: true });
  }

  const filename = `${user.id}.webp`;
  const filePath = join(avatarsDir, filename);

  await writeFile(filePath, webpBuffer);

  const avatarPath = `/avatars/${filename}`;

  await db.user.update({
    where: { id: user.id },
    data: { avatarPath },
  });

  logger.info({ event: 'avatar.updated', userId: user.id }, 'avatar updated');

  return NextResponse.json({ avatarUrl: avatarPath }, { status: 200 });
}
