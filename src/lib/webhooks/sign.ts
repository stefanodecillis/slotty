/**
 * Webhook payload signing and verification.
 * Header: X-Slotty-Signature
 * Format: t=<timestamp>,v1=<hex_hmac_sha256>
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Sign a webhook payload.
 * Returns the value for the X-Slotty-Signature header.
 */
export function signPayload(secret: string, body: string, timestamp: number): string {
  const signedContent = `${timestamp}.${body}`;
  const sig = createHmac('sha256', secret).update(signedContent, 'utf8').digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

/**
 * Verify a webhook signature using constant-time comparison.
 * Returns true if valid.
 */
export function verifySignature(
  secret: string,
  body: string,
  signatureHeader: string,
  toleranceSeconds = 300,
): boolean {
  try {
    const parts = signatureHeader.split(',');
    let timestamp: number | null = null;
    let receivedSig: string | null = null;

    for (const part of parts) {
      if (part.startsWith('t=')) timestamp = Number(part.slice(2));
      else if (part.startsWith('v1=')) receivedSig = part.slice(3);
    }

    if (timestamp === null || !receivedSig) return false;

    // Check timestamp tolerance.
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > toleranceSeconds) return false;

    const expected = signPayload(secret, body, timestamp);
    const expectedSig = expected.split('v1=')[1]!;

    // Constant-time comparison.
    const a = Buffer.from(receivedSig, 'hex');
    const b = Buffer.from(expectedSig, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
