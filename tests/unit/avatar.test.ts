/**
 * Avatar processing tests.
 * Tests magic-byte validation, sharp re-encoding, and EXIF stripping.
 */
import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

// ─── Magic byte helpers (inline so we don't import the route) ────────────────

function isAllowedImageType(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;

  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;

  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return true;

  return false;
}

// ─── Magic byte tests ────────────────────────────────────────────────────────

describe('magic byte validation', () => {
  it('accepts a JPEG header', () => {
    const jpeg = new Uint8Array(20).fill(0);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    jpeg[2] = 0xff;
    expect(isAllowedImageType(jpeg)).toBe(true);
  });

  it('accepts a PNG header', () => {
    const png = new Uint8Array(20).fill(0);
    png[0] = 0x89;
    png[1] = 0x50;
    png[2] = 0x4e;
    png[3] = 0x47;
    expect(isAllowedImageType(png)).toBe(true);
  });

  it('accepts a GIF header', () => {
    const gif = new Uint8Array(20).fill(0);
    gif[0] = 0x47; // G
    gif[1] = 0x49; // I
    gif[2] = 0x46; // F
    gif[3] = 0x38; // 8
    expect(isAllowedImageType(gif)).toBe(true);
  });

  it('accepts a WebP header', () => {
    const webp = new Uint8Array(20).fill(0);
    webp[0] = 0x52; // R
    webp[1] = 0x49; // I
    webp[2] = 0x46; // F
    webp[3] = 0x46; // F
    webp[8] = 0x57; // W
    webp[9] = 0x45; // E
    webp[10] = 0x42; // B
    webp[11] = 0x50; // P
    expect(isAllowedImageType(webp)).toBe(true);
  });

  it('rejects a PDF header (%PDF)', () => {
    const pdf = new Uint8Array(20).fill(0);
    pdf[0] = 0x25; // %
    pdf[1] = 0x50; // P
    pdf[2] = 0x44; // D
    pdf[3] = 0x46; // F
    expect(isAllowedImageType(pdf)).toBe(false);
  });

  it('rejects an EXE header (MZ)', () => {
    const exe = new Uint8Array(20).fill(0);
    exe[0] = 0x4d; // M
    exe[1] = 0x5a; // Z
    expect(isAllowedImageType(exe)).toBe(false);
  });

  it('rejects plain text', () => {
    const text = new TextEncoder().encode('Hello, world! This is plain text.');
    const padded = new Uint8Array(20);
    padded.set(text.slice(0, 20));
    expect(isAllowedImageType(padded)).toBe(false);
  });

  it('rejects a buffer shorter than 12 bytes', () => {
    const short = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG magic but too short
    expect(isAllowedImageType(short)).toBe(false);
  });
});

// ─── Sharp re-encoding tests ─────────────────────────────────────────────────

describe('sharp re-encoding', () => {
  it('produces a WebP buffer at 256x256', async () => {
    const sharp = (await import('sharp')).default;

    // Create a small test PNG in memory (1x1 red pixel).
    const inputBuffer = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const output = await sharp(inputBuffer)
      .resize(256, 256, { fit: 'cover', position: 'attention' })
      .withMetadata({})
      .toFormat('webp', { effort: 6 })
      .toBuffer();

    const meta = await sharp(output).metadata();

    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it('output is smaller than 1 MB', async () => {
    const sharp = (await import('sharp')).default;

    const inputBuffer = await sharp({
      create: { width: 1000, height: 1000, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    const output = await sharp(inputBuffer)
      .resize(256, 256, { fit: 'cover', position: 'attention' })
      .withMetadata({})
      .toFormat('webp', { effort: 6 })
      .toBuffer();

    expect(output.length).toBeLessThan(1 * 1024 * 1024);
  });
});

// ─── EXIF stripping tests ─────────────────────────────────────────────────────

describe('EXIF stripping', () => {
  it('output WebP has no EXIF data', async () => {
    const sharp = (await import('sharp')).default;

    // Create a JPEG with embedded density metadata.
    const inputBuffer = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 0, g: 100, b: 200 } },
    })
      .withMetadata({ density: 72 }) // embed metadata into the source JPEG
      .jpeg({ quality: 90 })
      .toBuffer();

    // The source JPEG has EXIF — verify this.
    const inputMeta = await sharp(inputBuffer).metadata();
    expect(inputMeta.exif).toBeDefined();

    // Process as the avatar route does (no .withMetadata() = strips all metadata).
    const output = await sharp(inputBuffer)
      .resize(256, 256, { fit: 'cover', position: 'attention' })
      .toFormat('webp', { effort: 6 })
      .toBuffer();

    const meta = await sharp(output).metadata();

    // EXIF must not be present in the output.
    expect(meta.exif).toBeUndefined();
  });
});
