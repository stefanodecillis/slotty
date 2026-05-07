/**
 * Sanitize a `next=` redirect parameter to prevent open-redirect attacks.
 *
 * Accepts only same-origin path-style redirects:
 *   - Must start with a single `/`
 *   - Must NOT start with `//` (protocol-relative URL → off-site)
 *   - Must NOT start with `/\` (browsers normalise `\` to `/`, so `/\evil.com`
 *     resolves to `http://evil.com/`)
 *   - Must NOT contain ASCII control chars (incl. CR/LF) or whitespace
 *     (prevents header-injection / response-splitting via redirect)
 *
 * Anything else falls back to `/admin`.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\x00-\x1f\x7f\s]/u;

export function sanitizeNext(
  next: string | undefined | null,
  fallback = '/admin',
): string {
  if (!next) return fallback;
  if (next.length > 512) return fallback;
  if (next[0] !== '/') return fallback;
  if (next[1] === '/' || next[1] === '\\') return fallback;
  if (FORBIDDEN_CHARS.test(next)) return fallback;
  return next;
}
