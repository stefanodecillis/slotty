/**
 * Confirmation links: how an AI assistant that can only *read* web pages
 * (Claude or ChatGPT chat, which can't send POST requests) still books a
 * slot or answers a poll. It writes a link to the same booking page with
 * everything filled in after `#`; its user opens it, checks, and presses
 * Confirm / Save. Opening the link saves nothing.
 *
 * The fragment never reaches a server, so names, emails and times stay out
 * of access logs. Values are read leniently — assistants don't always
 * percent-encode, and an unencoded `+` in a UTC offset arrives as a space.
 *
 * Pure and browser-safe.
 */
import type { VoteValue } from '@/lib/group-poll/rank';

/** A free-time range from a confirmation link, in epoch ms. */
export interface HandoffRange {
  start: number;
  end: number;
  value: VoteValue;
}

export interface BookingHandoff {
  slot: string | null;
  name: string | null;
  email: string | null;
  timezone: string | null;
  notes: string | null;
  guests: string[];
  /** Question id → answer. */
  answers: Record<string, string>;
}

export interface PollHandoff {
  name: string | null;
  email: string | null;
  timezone: string | null;
  ranges: HandoffRange[];
}

const MAX_TEXT = 5000;

function params(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ''));
}

/** An email whose unencoded `+` arrived as a space. */
function email(p: URLSearchParams): string | null {
  const v = text(p, 'email');
  return v ? v.replace(/ /g, '+') : null;
}

function text(p: URLSearchParams, key: string, max = 320): string | null {
  const v = p.get(key)?.trim();
  return v ? v.slice(0, max) : null;
}

/** An ISO instant, tolerating a `+` offset that arrived as a space. */
function instant(raw: string): number | null {
  const ms = Date.parse(raw.trim().replace(/ (\d\d:?\d\d)$/, '+$1'));
  return Number.isNaN(ms) ? null : ms;
}

function ranges(value: string | null, vote: VoteValue): HandoffRange[] {
  if (!value) return [];
  const out: HandoffRange[] = [];
  for (const part of value.split(',').slice(0, 500)) {
    const [a, b] = part.split('/');
    const start = a ? instant(a) : null;
    const end = b ? instant(b) : null;
    if (start !== null && end !== null && end > start) out.push({ start, end, value: vote });
  }
  return out;
}

/** True when the fragment carries anything a confirmation link would. */
export function hasHandoff(hash: string): boolean {
  const p = params(hash);
  return ['slot', 'name', 'email', 'free', 'maybe'].some((k) => p.has(k));
}

export function parseBookingHandoff(hash: string): BookingHandoff {
  const p = params(hash);
  const slotMs = p.get('slot') ? instant(p.get('slot')!) : null;
  const answers: Record<string, string> = {};
  for (const [k, v] of p) {
    if (k.startsWith('a.') && k.length > 2) answers[k.slice(2)] = v.slice(0, MAX_TEXT);
  }
  return {
    slot: slotMs === null ? null : new Date(slotMs).toISOString(),
    name: text(p, 'name', 200),
    email: email(p),
    timezone: text(p, 'tz', 100),
    notes: text(p, 'notes', MAX_TEXT),
    guests: (p.get('guests') ?? '')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)
      .slice(0, 20),
    answers,
  };
}

export function parsePollHandoff(hash: string): PollHandoff {
  const p = params(hash);
  return {
    name: text(p, 'name', 200),
    email: email(p),
    timezone: text(p, 'tz', 100),
    // "free" first so a range listed in both counts as "yes".
    ranges: [...ranges(p.get('free'), 'yes'), ...ranges(p.get('maybe'), 'maybe')],
  };
}

/** Candidate starts → vote, for the candidates that fit entirely inside a range. */
export function votesFromHandoff(
  slots: readonly { startUtc: string; endUtc: string }[],
  handoff: readonly HandoffRange[],
): Map<string, VoteValue> {
  const votes = new Map<string, VoteValue>();
  for (const slot of slots) {
    const s = Date.parse(slot.startUtc);
    const e = Date.parse(slot.endUtc);
    const hit =
      handoff.find((r) => r.start <= s && r.end >= e && r.value === 'yes') ??
      handoff.find((r) => r.start <= s && r.end >= e);
    if (hit) votes.set(slot.startUtc, hit.value);
  }
  return votes;
}
