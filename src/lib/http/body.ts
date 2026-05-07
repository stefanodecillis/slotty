import type { NextRequest } from 'next/server';

/**
 * Read the request body as either JSON or form-urlencoded, returning a plain
 * object. Useful for routes that are submitted from both:
 *   - native HTML `<form method="POST" action="..."/>` (form-urlencoded)
 *   - client-side `fetch(... { headers: { 'content-type': 'application/json' } })`
 *
 * Why a helper: in the Web Fetch API the request body is a one-shot stream.
 * `await req.json()` consumes it; if it then throws (because the body wasn't
 * actually JSON), `await req.text()` errors with "Body already used". So we
 * branch up-front on the Content-Type header and only call one consumer.
 *
 * On parse failure or unknown content-type, returns null.
 */
export async function readJsonOrForm(
  req: NextRequest | Request,
): Promise<Record<string, unknown> | null> {
  const ct = req.headers.get('content-type') ?? '';
  const lower = ct.toLowerCase();
  try {
    if (lower.includes('application/json')) {
      const v = await req.json();
      return v && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    }
    if (
      lower.includes('application/x-www-form-urlencoded') ||
      lower.includes('multipart/form-data')
    ) {
      // formData() handles both encodings and is one-shot.
      const fd = await req.formData();
      const out: Record<string, unknown> = {};
      for (const [k, v] of fd.entries()) {
        out[k] = typeof v === 'string' ? v : (v as { name?: string }).name ?? '';
      }
      return out;
    }
    // Unknown content type: try JSON as a last resort. If nothing was sent at
    // all (content-length 0), treat that as an empty object.
    const cl = req.headers.get('content-length');
    if (cl === '0') return {};
    if (!ct) {
      // No content-type. Read once as text and try JSON.
      const text = await req.text();
      if (!text) return {};
      try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}
