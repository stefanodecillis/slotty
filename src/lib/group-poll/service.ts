/**
 * Group availability polls ("find a time with a group").
 *
 * A one-time invitation with a `GroupPoll` row stops being a single-booker
 * link. Everyone who has the URL marks when they can make it — by hand, or
 * pre-filled from their Google free/busy — and the owner turns the best
 * common slot into one regular booking with every participant invited.
 *
 * Lifecycle (mirrors the invitation's):
 *   collecting — the link is live, participants can answer and edit their
 *                answer through a personal token.
 *   finalized  — the owner picked a time; the invite is consumed by the
 *                booking exactly like a normal one-time booking.
 *
 * Candidate slots are the invitation's own bookable slots (its availability,
 * the owner's busy calendar, buffers, notice, booking window). Votes are
 * keyed by UTC start, so when the owner's calendar fills up a slot simply
 * stops being a candidate and its votes are ignored.
 */
import type { EventType, User } from '@prisma/client';

import { db } from '@/lib/db';
import { decrypt, generateToken, hashToken } from '@/lib/crypto';
import { resolveInviteByRawToken } from '@/lib/booking/invite';
import { BookingError, createBooking } from '@/lib/booking/create';
import { computeSlots } from '@/lib/scheduling/compute';
import type { SlotDay } from '@/lib/scheduling/compute-types';
import {
  participantGoogleAvailability,
  participantRedirectUri,
  type BusyInterval,
  type ParticipantGoogleUnavailableReason,
} from '@/lib/google/participant-oauth';
import { logger } from '@/lib/logger';
import {
  freeSlotsFromBusy,
  rankSlots,
  tallySlots,
  type CandidateSlot,
  type SlotTally,
  type VoteValue,
} from './rank';
import { MAX_POLL_PARTICIPANTS, MAX_POLL_WINDOW_DAYS, type PollResponseInput } from './validator';

export class PollError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PollError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RANKED_LIMIT = 30;

// ─────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────

export interface PublicPollView {
  tz: string;
  days: SlotDay[];
  /** Per candidate start: how many can make it (and who, when names are shown). */
  tally: Record<string, { yes: number; maybe: number; yesNames?: string[]; maybeNames?: string[] }>;
  respondents: { count: number; names: string[] | null };
  maxParticipants: number;
  me: {
    name: string;
    email: string;
    timezone: string;
    source: string;
    googleSyncedAt: string | null;
    votes: { startUtc: string; value: VoteValue }[];
  } | null;
  google: { enabled: boolean };
}

export interface AdminPollParticipant {
  id: string;
  name: string;
  email: string;
  timezone: string;
  source: string;
  googleSyncedAt: string | null;
  updatedAt: string;
}

export interface AdminPollResults {
  status: 'collecting' | 'finalized';
  showNames: boolean;
  allowGoogle: boolean;
  participants: AdminPollParticipant[];
  /** Best slots first. Participant ids in yes / maybe / no. */
  ranked: SlotTally[];
  candidateCount: number;
  google:
    | { available: true; redirectUri: string }
    | { available: false; reason: ParticipantGoogleUnavailableReason; redirectUri: string };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** [from, to) the poll's candidates (and a Google free/busy read) cover. */
export function pollWindow(eventType: Pick<EventType, 'bookingWindowDays'>, now: Date): { from: Date; to: Date } {
  const days = Math.min(eventType.bookingWindowDays, MAX_POLL_WINDOW_DAYS);
  // +1 day so the last day's slots in far-west zones aren't clipped; the
  // slot engine enforces the booking window itself.
  return { from: now, to: new Date(now.getTime() + (days + 1) * DAY_MS) };
}

async function loadCandidates(
  eventType: EventType,
  owner: User,
  tz: string,
  now: Date,
): Promise<SlotDay[]> {
  const { from, to } = pollWindow(eventType, now);
  const result = await computeSlots({ eventType, user: owner, from, to, bookerTz: tz, now });
  return result.days;
}

function flatten(days: readonly SlotDay[]): CandidateSlot[] {
  return days.flatMap((d) => d.slots.map((s) => ({ startUtc: s.startUtc, endUtc: s.endUtc })));
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

async function loadOwner(eventType: EventType): Promise<User> {
  const owner = await db.user.findUnique({ where: { id: eventType.userId } });
  if (!owner) throw new PollError('Owner missing', 404);
  return owner;
}

/** Resolve a public invite token to its live poll. 404 unknown, 410 closed. */
async function resolveOpenPoll(rawToken: string) {
  const resolved = await resolveInviteByRawToken(rawToken);
  if (!resolved.eventType || resolved.eventType.archived) throw new PollError('Not found', 404);
  const poll = await db.groupPoll.findUnique({ where: { eventTypeId: resolved.eventType.id } });
  if (!poll) throw new PollError('Not found', 404);
  if (resolved.status !== 'ok' || poll.status !== 'collecting') {
    throw new PollError('This poll is closed.', 410);
  }
  return { eventType: resolved.eventType, poll };
}

async function findParticipant(pollId: string, participantToken: string | null | undefined) {
  if (!participantToken) return null;
  const participant = await db.pollParticipant.findUnique({
    where: { editTokenHash: hashToken(participantToken) },
    include: { votes: true },
  });
  if (!participant || participant.pollId !== pollId) {
    throw new PollError('Your personal link is not valid for this poll.', 403);
  }
  return participant;
}

function votesMap(votes: readonly { slotStart: Date; value: string }[]): Map<string, VoteValue> {
  const map = new Map<string, VoteValue>();
  for (const v of votes) map.set(v.slotStart.toISOString(), v.value === 'maybe' ? 'maybe' : 'yes');
  return map;
}

async function replaceVotes(
  participantId: string,
  votes: readonly { startUtc: string; value: VoteValue }[],
): Promise<void> {
  await db.$transaction([
    db.pollVote.deleteMany({ where: { participantId } }),
    db.pollVote.createMany({
      data: votes.map((v) => ({ participantId, slotStart: new Date(v.startUtc), value: v.value })),
    }),
  ]);
}

function googleEnabledFor(poll: { allowGoogle: boolean }): boolean {
  return poll.allowGoogle && participantGoogleAvailability().available;
}

// ─────────────────────────────────────────────────────────────
// Public — participants
// ─────────────────────────────────────────────────────────────

/** The poll behind an invitation (if any). The public page uses it to pick its UI. */
export async function getPollStateForEventType(eventTypeId: string) {
  return db.groupPoll.findUnique({
    where: { eventTypeId },
    select: {
      id: true,
      status: true,
      finalizedBookingId: true,
      allowGoogle: true,
    },
  });
}

export async function getPublicPollView(
  rawToken: string,
  tz: string,
  participantToken: string | null,
  now: Date = new Date(),
): Promise<PublicPollView> {
  const { eventType, poll } = await resolveOpenPoll(rawToken);
  const owner = await loadOwner(eventType);
  const me = await findParticipant(poll.id, participantToken);

  const [days, participants] = await Promise.all([
    loadCandidates(eventType, owner, tz, now),
    db.pollParticipant.findMany({
      where: { pollId: poll.id },
      orderBy: { createdAt: 'asc' },
      include: { votes: true },
    }),
  ]);

  const names = new Map(participants.map((p) => [p.id, p.name]));
  const tallies = tallySlots(
    flatten(days),
    participants.map((p) => ({ id: p.id, votes: votesMap(p.votes) })),
  );
  const tally: PublicPollView['tally'] = {};
  for (const t of tallies) {
    if (t.yes.length + t.maybe.length === 0) continue;
    tally[t.startUtc] = poll.showNames
      ? {
          yes: t.yes.length,
          maybe: t.maybe.length,
          yesNames: t.yes.map((id) => names.get(id) ?? ''),
          maybeNames: t.maybe.map((id) => names.get(id) ?? ''),
        }
      : { yes: t.yes.length, maybe: t.maybe.length };
  }

  return {
    tz,
    days,
    tally,
    respondents: {
      count: participants.length,
      names: poll.showNames ? participants.map((p) => p.name) : null,
    },
    maxParticipants: MAX_POLL_PARTICIPANTS,
    me: me
      ? {
          name: me.name,
          email: me.email,
          timezone: me.timezone,
          source: me.source,
          googleSyncedAt: me.googleSyncedAt?.toISOString() ?? null,
          votes: me.votes.map((v) => ({
            startUtc: v.slotStart.toISOString(),
            value: v.value === 'maybe' ? 'maybe' : 'yes',
          })),
        }
      : null,
    google: { enabled: googleEnabledFor(poll) },
  };
}

/**
 * Create or update a participant's answer. Without a personal token a new
 * participant is created (one per email); with one, that participant's
 * answer is replaced. Votes outside the current candidates are dropped.
 * Returns the raw personal token for new participants.
 */
export async function submitPollResponse(
  rawToken: string,
  input: PollResponseInput,
  participantToken: string | null,
  now: Date = new Date(),
): Promise<{ participantId: string; participantToken: string | null }> {
  const { eventType, poll } = await resolveOpenPoll(rawToken);
  const owner = await loadOwner(eventType);
  const existing = await findParticipant(poll.id, participantToken);

  const candidates = new Set(flatten(await loadCandidates(eventType, owner, 'UTC', now)).map((c) => c.startUtc));
  const seen = new Set<string>();
  const votes: { startUtc: string; value: VoteValue }[] = [];
  for (const v of input.votes) {
    const iso = toIso(v.startUtc);
    if (!candidates.has(iso) || seen.has(iso)) continue;
    seen.add(iso);
    votes.push({ startUtc: iso, value: v.value });
  }

  const emailOwner = await db.pollParticipant.findUnique({
    where: { pollId_email: { pollId: poll.id, email: input.email } },
    select: { id: true },
  });
  if (emailOwner && emailOwner.id !== existing?.id) {
    throw new PollError(
      'Someone already answered with this email. Use your personal link to change your answer.',
      409,
    );
  }

  let participantId: string;
  let newToken: string | null = null;
  if (existing) {
    participantId = existing.id;
    await db.pollParticipant.update({
      where: { id: existing.id },
      data: { name: input.name, email: input.email, timezone: input.timezone },
    });
  } else {
    const count = await db.pollParticipant.count({ where: { pollId: poll.id } });
    if (count >= MAX_POLL_PARTICIPANTS) {
      throw new PollError('This poll is full.', 409);
    }
    const token = generateToken(24);
    const created = await db.pollParticipant.create({
      data: {
        pollId: poll.id,
        name: input.name,
        email: input.email,
        timezone: input.timezone,
        editTokenHash: token.hash,
      },
      select: { id: true },
    });
    participantId = created.id;
    newToken = token.token;
  }

  await replaceVotes(participantId, votes);
  return { participantId, participantToken: newToken };
}

/**
 * Validate that a participant may start a Google import right now.
 * Returns what the OAuth round-trip needs to carry.
 */
export async function prepareGoogleImport(
  rawToken: string,
  participantToken: string,
): Promise<{ participantId: string }> {
  const { poll } = await resolveOpenPoll(rawToken);
  if (!googleEnabledFor(poll)) {
    throw new PollError('Google Calendar import is not available for this poll.', 403);
  }
  const participant = await findParticipant(poll.id, participantToken);
  if (!participant) throw new PollError('Answer the poll first.', 403);
  return { participantId: participant.id };
}

/** The [from, to) window to read a participant's free/busy for. */
export async function googleImportWindow(
  participantId: string,
  now: Date = new Date(),
): Promise<{ from: Date; to: Date }> {
  const participant = await db.pollParticipant.findUnique({
    where: { id: participantId },
    include: { poll: { include: { eventType: true } } },
  });
  if (!participant) throw new PollError('Not found', 404);
  return pollWindow(participant.poll.eventType, now);
}

/**
 * Replace a participant's answer with "available" on every candidate slot
 * that doesn't overlap their Google busy blocks. Only the resulting votes
 * are kept — the busy blocks themselves are discarded.
 */
export async function applyGoogleBusy(
  participantId: string,
  busy: readonly BusyInterval[],
  now: Date = new Date(),
): Promise<{ availableSlots: number }> {
  const participant = await db.pollParticipant.findUnique({
    where: { id: participantId },
    include: {
      poll: {
        include: {
          eventType: { include: { invites: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        },
      },
    },
  });
  if (!participant) throw new PollError('Not found', 404);
  const { poll } = participant;
  const invite = poll.eventType.invites[0];
  const inviteLive =
    invite &&
    !invite.usedAt &&
    !invite.revokedAt &&
    (!invite.expiresAt || invite.expiresAt.getTime() > now.getTime());
  if (poll.status !== 'collecting' || !inviteLive) throw new PollError('This poll is closed.', 410);

  const owner = await loadOwner(poll.eventType);
  const candidates = flatten(await loadCandidates(poll.eventType, owner, 'UTC', now));
  const free = freeSlotsFromBusy(candidates, busy);

  await replaceVotes(
    participantId,
    free.map((startUtc) => ({ startUtc, value: 'yes' as const })),
  );
  await db.pollParticipant.update({
    where: { id: participantId },
    data: { source: 'google', googleSyncedAt: now },
  });
  return { availableSlots: free.length };
}

/** Finalized time for a closed poll, for the "time confirmed" panel. */
export async function getFinalizedPollMeeting(eventTypeId: string) {
  const poll = await db.groupPoll.findUnique({ where: { eventTypeId } });
  if (!poll || poll.status !== 'finalized' || !poll.finalizedBookingId) return null;
  const booking = await db.booking.findUnique({
    where: { id: poll.finalizedBookingId },
    select: { startAt: true, endAt: true, status: true, meetingUrl: true },
  });
  if (!booking || booking.status === 'cancelled') return null;
  return booking;
}

// ─────────────────────────────────────────────────────────────
// Admin — results, finalize, moderation
// ─────────────────────────────────────────────────────────────

async function loadOwnedPoll(userId: string, eventTypeId: string) {
  const eventType = await db.eventType.findFirst({
    where: { id: eventTypeId, userId, isOneTime: true },
    include: {
      invites: { orderBy: { createdAt: 'desc' }, take: 1 },
      groupPoll: {
        include: {
          participants: { orderBy: { createdAt: 'asc' }, include: { votes: true } },
        },
      },
    },
  });
  if (!eventType?.groupPoll) throw new PollError('Poll not found', 404);
  return { eventType, poll: eventType.groupPoll };
}

export async function getPollResults(
  userId: string,
  eventTypeId: string,
  now: Date = new Date(),
): Promise<AdminPollResults> {
  const { eventType, poll } = await loadOwnedPoll(userId, eventTypeId);
  const owner = await loadOwner(eventType);
  const candidates =
    poll.status === 'collecting' ? flatten(await loadCandidates(eventType, owner, owner.timezone, now)) : [];
  const ranked = rankSlots(
    tallySlots(
      candidates,
      poll.participants.map((p) => ({ id: p.id, votes: votesMap(p.votes) })),
    ),
  ).slice(0, RANKED_LIMIT);

  const availability = participantGoogleAvailability();
  const redirectUri = participantRedirectUri();
  return {
    status: poll.status === 'finalized' ? 'finalized' : 'collecting',
    showNames: poll.showNames,
    allowGoogle: poll.allowGoogle,
    participants: poll.participants.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      timezone: p.timezone,
      source: p.source,
      googleSyncedAt: p.googleSyncedAt?.toISOString() ?? null,
      updatedAt: p.updatedAt.toISOString(),
    })),
    ranked,
    candidateCount: candidates.length,
    google: availability.available
      ? { available: true, redirectUri }
      : { available: false, reason: availability.reason, redirectUri },
  };
}

/**
 * Book the chosen slot for everyone. The participant who can make it (first
 * to answer) becomes the booker, everyone else who answered is invited as a
 * guest, and the invitation is consumed by the booking like any one-time
 * booking — so the slot re-check, Google insert, and Meet link all come from
 * the regular booking pipeline.
 */
export async function finalizePoll(
  userId: string,
  eventTypeId: string,
  startUtc: string,
): Promise<{ bookingId: string; needsSync: boolean }> {
  const { eventType, poll } = await loadOwnedPoll(userId, eventTypeId);
  if (poll.status !== 'collecting') throw new PollError('A time has already been picked.', 409);
  if (poll.participants.length === 0) throw new PollError('Nobody has answered yet.', 409);
  const invite = eventType.invites[0];
  if (!invite?.tokenEnc) throw new PollError('This invitation can no longer be booked.', 409);

  const start = toIso(startUtc);
  const voteAt = (p: (typeof poll.participants)[number]) =>
    p.votes.find((v) => v.slotStart.toISOString() === start)?.value ?? null;
  const booker =
    poll.participants.find((p) => voteAt(p) === 'yes') ??
    poll.participants.find((p) => voteAt(p) === 'maybe') ??
    poll.participants[0]!;
  const guests = poll.participants.filter((p) => p.id !== booker.id).map((p) => p.email);

  let bookingId: string;
  let needsSync: boolean;
  try {
    const created = await createBooking({
      inviteToken: decrypt(invite.tokenEnc),
      startAtIso: start,
      bookerName: booker.name,
      bookerEmail: booker.email,
      bookerTimezone: booker.timezone,
      additionalGuests: guests,
      // One booking per poll, even if the owner double-clicks.
      clientRequestId: `poll-${poll.id}`,
      eventSummary: eventType.title,
      viaGroupPoll: true,
    });
    bookingId = created.booking.id;
    needsSync = created.needsSync;
  } catch (err) {
    if (err instanceof BookingError) throw new PollError(err.message, err.httpStatus);
    throw err;
  }

  await db.groupPoll.update({
    where: { id: poll.id },
    data: { status: 'finalized', finalizedBookingId: bookingId },
  });
  logger.info(
    { event: 'poll.finalized', pollId: poll.id, bookingId, participants: poll.participants.length },
    'group poll finalized',
  );
  return { bookingId, needsSync };
}

/** Drop a participant (spam, duplicate, someone who's no longer coming). */
export async function removePollParticipant(
  userId: string,
  eventTypeId: string,
  participantId: string,
): Promise<void> {
  const { poll } = await loadOwnedPoll(userId, eventTypeId);
  if (poll.status !== 'collecting') throw new PollError('A time has already been picked.', 409);
  const result = await db.pollParticipant.deleteMany({ where: { id: participantId, pollId: poll.id } });
  if (result.count === 0) throw new PollError('Participant not found', 404);
}
