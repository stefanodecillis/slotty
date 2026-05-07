import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

/** Only allow filenames matching this pattern to prevent path traversal. */
const SAFE_FILENAME_RE = /^[a-zA-Z0-9_-]+\.webp$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: { file: string } },
): Promise<NextResponse> {
  const filename = params.file;

  if (!SAFE_FILENAME_RE.test(filename)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const filePath = join(process.cwd(), 'data', 'avatars', filename);

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
