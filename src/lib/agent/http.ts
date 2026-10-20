/**
 * Shared request/response handling for the agent descriptor routes.
 */
import type { NextRequest } from 'next/server';
import { DateTime } from 'luxon';

import { getClientIp } from '@/lib/http/client-ip';
import { consume, type RateLimitConfig } from '@/lib/ratelimit';
import type { AgentLinkDescriptor, DescribeOptions } from './descriptor';
import { renderDescriptorMarkdown } from './markdown';
import { resolveAgentFormat, type AgentFormat } from './negotiate';

// Descriptors carry capability URLs and availability: never cached, indexed,
// or leaked through Referer.
const PRIVATE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  Vary: 'Accept',
};

function reply(
  format: AgentFormat,
  status: number,
  body: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      ...PRIVATE_HEADERS,
      'Content-Type':
        format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
      ...extra,
    },
  });
}

function errorReply(
  format: AgentFormat,
  status: number,
  message: string,
  extra?: Record<string, string>,
): Response {
  const body = format === 'markdown' ? `# ${message}\n` : JSON.stringify({ error: message });
  return reply(format, status, body, extra);
}

function isValidIanaTz(tz: string): boolean {
  if (!tz || tz.length > 100 || /[<>'"`]/.test(tz)) return false;
  return DateTime.now().setZone(tz).isValid;
}

/**
 * Rate limit (sharing the slot endpoints' bucket — a descriptor computes the
 * same slots), parse `tz` / `from` / `format`, and render the descriptor.
 */
export async function serveDescriptor(
  req: NextRequest | Request,
  limit: { scope: string } & RateLimitConfig,
  describe: (opts: DescribeOptions) => Promise<AgentLinkDescriptor | null>,
): Promise<Response> {
  const url = new URL(req.url);
  const format = resolveAgentFormat(url.searchParams.get('format'), req.headers.get('accept'));

  const decision = consume(limit.scope, getClientIp(req.headers), limit);
  if (!decision.allowed) {
    return errorReply(format, 429, 'Rate limit exceeded', {
      'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)),
      'X-RateLimit-Limit': String(decision.limit),
      'X-RateLimit-Remaining': '0',
    });
  }

  const tz = url.searchParams.get('tz') ?? 'UTC';
  if (!isValidIanaTz(tz)) return errorReply(format, 400, 'Invalid IANA timezone');
  const fromParam = url.searchParams.get('from');
  const fromMs = fromParam ? Date.parse(fromParam) : NaN;
  if (fromParam && Number.isNaN(fromMs))
    return errorReply(format, 400, 'Invalid from (expected an ISO 8601 instant)');

  const descriptor = await describe({ tz, from: fromParam ? new Date(fromMs) : undefined });
  if (!descriptor) return errorReply(format, 404, 'Not found');

  const body =
    format === 'markdown'
      ? renderDescriptorMarkdown(descriptor)
      : JSON.stringify(descriptor, null, 2);
  return reply(format, 200, body, {
    'X-RateLimit-Limit': String(decision.limit),
    'X-RateLimit-Remaining': String(decision.remaining),
  });
}
