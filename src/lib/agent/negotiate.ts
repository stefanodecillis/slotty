/**
 * "One link for humans and AI assistants": decide whether a request for a
 * booking page (`/<slug>`, `/i/<token>`) is really asking for the
 * machine-readable description of that link, and where that lives.
 *
 * Edge-safe (used by middleware): no Node or DB imports.
 */

export type AgentFormat = 'json' | 'markdown';

interface MediaRange {
  type: string;
  q: number;
  order: number;
}

function parseAccept(accept: string): MediaRange[] {
  const out: MediaRange[] = [];
  accept.split(',').forEach((part, order) => {
    const [rawType, ...params] = part.split(';');
    const type = rawType?.trim().toLowerCase();
    if (!type) return;
    let q = 1;
    for (const p of params) {
      const [k, v] = p.split('=');
      if (k?.trim().toLowerCase() === 'q') {
        const n = Number(v?.trim());
        q = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
      }
    }
    out.push({ type, q, order });
  });
  return out;
}

const FORMAT_TYPES: Record<string, AgentFormat> = {
  'application/json': 'json',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
};

/**
 * The agent format an `Accept` header explicitly prefers over HTML, if any.
 * Only exact `application/json` / `text/markdown` ranges count — wildcards
 * (`*\/*`, `text/*`) never select an agent format, so browsers, link
 * previewers and plain `curl` keep getting the page.
 */
export function agentFormatFromAccept(accept: string | null): AgentFormat | null {
  if (!accept) return null;
  const ranges = parseAccept(accept);
  let html = 0;
  let best: MediaRange | null = null;
  for (const r of ranges) {
    if (r.type === 'text/html' || r.type === 'application/xhtml+xml') {
      html = Math.max(html, r.q);
      continue;
    }
    if (!(r.type in FORMAT_TYPES) || r.q <= 0) continue;
    if (!best || r.q > best.q) best = r;
  }
  if (!best || best.q <= html) return null;
  return FORMAT_TYPES[best.type] ?? null;
}

/** `?format=` wins; then `Accept`; JSON otherwise. For the agent routes themselves. */
export function resolveAgentFormat(format: string | null, accept: string | null): AgentFormat {
  const f = format?.toLowerCase();
  if (f === 'markdown' || f === 'md') return 'markdown';
  if (f === 'json') return 'json';
  return agentFormatFromAccept(accept) ?? 'json';
}

// Mirrors the event-type slug rule and reserved list (eventtype/validator.ts).
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED = new Set(['admin', 'setup', 'api', 'b', 'i', 'avatars', '_next', 'static']);
// generateToken() emits base64url.
const TOKEN_RE = /^[A-Za-z0-9_-]{8,200}$/;

/** Agent description path for a booking page path, or null for anything else. */
export function agentPathFor(pathname: string): string | null {
  const invite = /^\/i\/([^/]+)\/?$/.exec(pathname);
  if (invite) {
    const token = invite[1]!;
    return TOKEN_RE.test(token) ? `/api/agent/invites/${token}` : null;
  }
  const slug = /^\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (slug && SLUG_RE.test(slug) && !RESERVED.has(slug)) return `/api/agent/links/${slug}`;
  return null;
}

/**
 * Requests Next.js makes for its own router (RSC payloads, prefetches,
 * actions). Defense in depth only: in middleware Next has already stripped
 * the RSC / router-state / prefetch headers, and its router fetches never
 * send an explicit JSON or Markdown `Accept` — which is what actually keeps
 * them away from the agent view (see `agentFormatFromAccept`).
 */
export function isFrameworkRequest(headers: Headers): boolean {
  for (const h of ['rsc', 'next-router-prefetch', 'next-router-state-tree', 'next-url', 'next-action']) {
    if (headers.has(h)) return true;
  }
  const purpose = (headers.get('purpose') ?? headers.get('sec-purpose') ?? '').toLowerCase();
  return purpose.includes('prefetch');
}
