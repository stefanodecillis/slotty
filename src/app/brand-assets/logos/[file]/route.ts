import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

const SAFE_FILENAME_RE = /^[a-zA-Z0-9_-]+\.webp$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: { file: string } },
): Promise<NextResponse> {
  if (!SAFE_FILENAME_RE.test(params.file)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const filePath = join(process.cwd(), 'data', 'brand-logos', params.file);

  try {
    await stat(filePath);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const fileBuffer = await readFile(filePath);

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(fileBuffer.length),
    },
  });
}
