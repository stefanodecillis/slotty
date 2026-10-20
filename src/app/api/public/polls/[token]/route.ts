/**
 * GET  /api/public/polls/[token]?tz=… — the group poll behind a one-time
 *      invite: candidate slots in the participant's timezone, how many people
 *      can make each one, and (with a personal token) the caller's own answer.
 * POST /api/public/polls/[token] — submit or replace an answer, as explicit
 *      `votes` or as free-time `available` ranges (what AI assistants send).
 *      New participants get their personal token back once; it's the only way
 *      to edit the answer later. The response echoes the votes stored.
 *
 * `[token]` is the invite token from `/i/<token>`. The personal token travels
 * in the `X-Poll-Participant` header so it stays out of URLs and access logs.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';

import { getClientIp } from '@/lib/http/client-ip';
import { consume } from '@/lib/ratelimit';
import { getPublicPollView, PollError, submitPollResponse } from '@/lib/group-poll/service';
import { pollResponseSchema } from '@/lib/group-poll/validator';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { token: string };
}

const PARTICIPANT_HEADER = 'x-poll-participant';

const READ_LIMIT = { capacity: 60, windowMs: 60_000 };
const WRITE_LIMIT = { capacity: 20, windowMs: 60_000 };
/** A full grid of votes at the finest interval stays well under this. */
const MAX_BODY_BYTES = 1_000_000;
const NO_STORE = { 'Cache-Control': 'private, no-store' };

function rateLimited(retryAfterMs: number, limit: number): Response {
  return NextResponse.json(
    { error: 'Too many requests. Please slow down.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': '0',
      },
    },
  );
}

function isValidIanaTz(tz: string): boolean {
  if (!tz || tz.length > 100 || /[<>'"`]/.test(tz)) return false;
  return DateTime.now().setZone(tz).isValid;
}

function pollErrorResponse(err: unknown): Response {
  if (err instanceof PollError) {
    return NextResponse.json({ error: err.message }, { status: err.status, headers: NO_STORE });
  }
  throw err;
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const decision = consume('public-poll-read', getClientIp(req.headers), READ_LIMIT);
  if (!decision.allowed) return rateLimited(decision.retryAfterMs, decision.limit);

  const tz = new URL(req.url).searchParams.get('tz') ?? 'UTC';
  if (!isValidIanaTz(tz)) {
    return NextResponse.json({ error: 'Invalid IANA timezone' }, { status: 400 });
  }

  try {
    const view = await getPublicPollView(params.token, tz, req.headers.get(PARTICIPANT_HEADER));
    return NextResponse.json(view, { headers: NO_STORE });
  } catch (err) {
    return pollErrorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const decision = consume('public-poll-write', getClientIp(req.headers), WRITE_LIMIT);
  if (!decision.allowed) return rateLimited(decision.retryAfterMs, decision.limit);

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = pollResponseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }
  if (!isValidIanaTz(parsed.data.timezone)) {
    return NextResponse.json({ error: 'Invalid IANA timezone' }, { status: 400 });
  }

  try {
    const result = await submitPollResponse(
      params.token,
      parsed.data,
      req.headers.get(PARTICIPANT_HEADER),
    );
    return NextResponse.json(
      {
        participantToken: result.participantToken,
        replayed: result.replayed,
        votes: result.votes,
        droppedVotes: result.droppedVotes,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    return pollErrorResponse(err);
  }
}
