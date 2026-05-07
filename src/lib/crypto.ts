import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { env } from './env';

/**
 * AES-256-GCM helpers for encrypting OAuth tokens, SMTP passwords, TOTP secrets,
 * and any other secrets-at-rest. The key comes from SLOTTY_ENCRYPTION_KEY (32
 * bytes, base64). Output format: `v1.<iv-b64>.<authTag-b64>.<ciphertext-b64>`.
 *
 * Versioning the prefix (`v1.`) lets us migrate algorithms in future without
 * breaking already-encrypted blobs.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

let keyCache: Buffer | null = null;
function getKey(): Buffer {
  if (!keyCache) {
    keyCache = Buffer.from(env.SLOTTY_ENCRYPTION_KEY, 'base64');
    if (keyCache.length !== 32) {
      throw new Error('SLOTTY_ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
  }
  return keyCache;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64(iv), b64(tag), b64(ciphertext)].join('.');
}

export function decrypt(blob: string): string {
  const parts = blob.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Invalid ciphertext format');
  }
  const iv = unb64(parts[1]!);
  const tag = unb64(parts[2]!);
  const ct = unb64(parts[3]!);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Invalid ciphertext: bad iv/tag length');
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Generate a URL-safe random token (e.g. cancel/reschedule tokens).
 * Returns the raw token (to send to the user) and a sha256 hex hash
 * suitable for storing in the database.
 */
export function generateToken(byteLength = 32): { token: string; hash: string } {
  const token = randomBytes(byteLength).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function hmac(secret: string | Buffer, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

function b64(buf: Buffer): string {
  return buf.toString('base64');
}
function unb64(s: string): Buffer {
  return Buffer.from(s, 'base64');
}
