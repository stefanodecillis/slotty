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
import { randomUUID } from 'node:crypto';
import type { EventType, Prisma, User } from '@prisma/client';

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
  votesFromRanges,
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
  /** Times this answer marks among the current candidates. 0 means it says nothing. */
  marked: number;
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

/** Who is answering — everything a new participant row needs besides votes. */
export interface ParticipantDetails {
  name: string;
  email: string;
  timezone: string;
}

/**
 * Add a participant, unless the poll is full or (with `clientRequestHash`) a
 * retry of the same answer already added them. One statement checks both and
 * inserts, so it is atomic: concurrent first saves can't push the poll over
 * the cap or add the same answer twice, and nothing is left to undo.
 * (Prisma can't express a conditional insert, and its interactive
 * transactions stall under write contention on SQLite.) DateTime columns
 * hold epoch milliseconds, which is how Prisma writes them on SQLite.
 */
async function insertParticipant(args: {
  pollId: string;
  details: ParticipantDetails;
  source: string;
  clientRequestHash: string | null;
  googleSyncedAt?: Date;
}): Promise<{ id: string; token: string } | null> {
  const { pollId, details, source, clientRequestHash } = args;
  const token = generateToken(24);
  const id = randomUUID();
  const at = Date.now();
  const synced = args.googleSyncedAt ? args.googleSyncedAt.getTime() : null;
  const inserted = await db.$executeRaw`
    INSERT INTO "poll_participants"
      ("id", "poll_id", "name", "email", "timezone", "edit_token_hash", "source", "client_request_hash", "google_synced_at", "created_at", "updated_at")
    SELECT ${id}, ${pollId}, ${details.name}, ${details.email}, ${details.timezone}, ${token.hash}, ${source}, ${clientRequestHash}, ${synced}, ${at}, ${at}
    WHERE (SELECT COUNT(*) FROM "poll_participants" WHERE "poll_id" = ${pollId}) < ${MAX_POLL_PARTICIPANTS}
      AND NOT EXISTS (
        SELECT 1 FROM "poll_participants"
        WHERE "poll_id" = ${pollId} AND "client_request_hash" = ${clientRequestHash}
      )`;
  return inserted === 1 ? { id, token: token.token } : null;
}

/** What a saved answer ended up as, so a client can check it against what it meant. */
export interface PollSubmitResult {
  participantId: string;
  /** Raw personal token, only for a newly created participant. */
  participantToken: string | null;
  /** True when a retry with the same clientRequestId updated an earlier answer. */
  replayed: boolean;
  /** The votes stored, in candidate order. */
  votes: { startUtc: string; value: VoteValue }[];
  /** Requested vote starts that aren't current candidates (ignored). */
  droppedVotes: string[];
}

/**
 * Create or update a participant's answer. Without a personal token a new
 * participant is created; with one, that participant's answer is replaced.
 * Votes outside the current candidates are dropped; free-time ranges become
 * votes for the candidates they cover. Returns the raw personal token for
 * new participants.
 *
 * A `clientRequestId` on a first answer makes it retry-safe: the same id
 * again updates that participant rather than adding another one.
 *
 * Emails are deliberately not unique per poll: refusing a taken address
 * would tell anyone with the link who answered, even when names are hidden.
 * The owner sees repeated emails and the booking invites each address once.
 */
export async function submitPollResponse(
  rawToken: string,
  input: PollResponseInput,
  participantToken: string | null,
  now: Date = new Date(),
): Promise<PollSubmitResult> {
  const { eventType, poll } = await resolveOpenPoll(rawToken);
  const owner = await loadOwner(eventType);
  const existing = await findParticipant(poll.id, participantToken);

  const candidates = flatten(await loadCandidates(eventType, owner, 'UTC', now));
  const { votes, droppedVotes } = resolveVotes(candidates, input);
  // An answer is the times someone can make. Without any it would sit in the
  // results as a name with nothing behind it; "none of these work" is
  // something to tell the organizer, not an answer.
  if (votes.length === 0) {
    throw new PollError(
      input.available
        ? 'None of those free times covers a whole candidate time. Mark at least one time you can make.'
        : droppedVotes.length > 0
          ? 'The times you picked are no longer open. Pick from the current times.'
          : 'Mark at least one time you can make.',
      422,
    );
  }
  const source = input.via === 'agent' ? 'agent' : undefined;
  const clientRequestHash =
    !existing && input.clientRequestId ? hashToken(`${poll.id}:${input.clientRequestId}`) : null;

  const update = async (participantId: string): Promise<void> => {
    await db.pollParticipant.update({
      where: { id: participantId },
      data: { name: input.name, email: input.email, timezone: input.timezone, ...(source ? { source } : {}) },
    });
  };
  const findRetried = async () =>
    clientRequestHash
      ? db.pollParticipant.findUnique({
          where: { pollId_clientRequestHash: { pollId: poll.id, clientRequestHash } },
          select: { id: true },
        })
      : null;

  let participantId: string;
  let newToken: string | null = null;
  let replayed = false;
  const retried = existing ? null : await findRetried();
  if (existing || retried) {
    participantId = (existing ?? retried)!.id;
    replayed = Boolean(retried);
    await update(participantId);
  } else {
    const created = await insertParticipant({
      pollId: poll.id,
      details: input,
      source: source ?? 'manual',
      clientRequestHash,
    });
    if (created) {
      participantId = created.id;
      newToken = created.token;
    } else {
      // Either a concurrent retry of this answer inserted first, or the poll is full.
      const raced = await findRetried();
      if (!raced) throw new PollError('This poll is full.', 409);
      participantId = raced.id;
      replayed = true;
      await update(participantId);
    }
  }

  await replaceVotes(participantId, votes);
  return { participantId, participantToken: newToken, replayed, votes, droppedVotes };
}

/** The votes an answer amounts to over the current candidates. */
function resolveVotes(
  candidates: readonly CandidateSlot[],
  input: PollResponseInput,
): { votes: { startUtc: string; value: VoteValue }[]; droppedVotes: string[] } {
  if (input.available) {
    const ranges = input.available.map((r) => ({
      start: new Date(r.start),
      end: new Date(r.end),
      value: r.value,
    }));
    return { votes: votesFromRanges(candidates, ranges), droppedVotes: [] };
  }
  const known = new Set(candidates.map((c) => c.startUtc));
  const seen = new Set<string>();
  const votes: { startUtc: string; value: VoteValue }[] = [];
  const droppedVotes: string[] = [];
  for (const v of input.votes ?? []) {
    const iso = toIso(v.startUtc);
    if (seen.has(iso)) continue;
    seen.add(iso);
    if (!known.has(iso)) {
      droppedVotes.push(iso);
      continue;
    }
    votes.push({ startUtc: iso, value: v.value });
  }
  votes.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  return { votes, droppedVotes };
}

/**
 * Validate that a Google import may start right now: for an existing
 * participant (re-import, needs their personal token), or for someone new.
 * A new participant isn't saved until Google comes back with free time, so
 * an abandoned or empty import never leaves an empty answer behind.
 */
export async function prepareGoogleImport(
  rawToken: string,
  participantToken: string | null,
): Promise<{ pollId: string; participantId: string | null }> {
  const { poll } = await resolveOpenPoll(rawToken);
  if (!googleEnabledFor(poll)) {
    throw new PollError('Google Calendar import is not available for this poll.', 403);
  }
  if (participantToken) {
    const participant = await findParticipant(poll.id, participantToken);
    return { pollId: poll.id, participantId: participant!.id };
  }
  const count = await db.pollParticipant.count({ where: { pollId: poll.id } });
  if (count >= MAX_POLL_PARTICIPANTS) throw new PollError('This poll is full.', 409);
  return { pollId: poll.id, participantId: null };
}

/** A poll that still collects answers, with the event type its candidates come from. */
async function loadLivePoll(pollId: string, now: Date) {
  const poll = await db.groupPoll.findUnique({
    where: { id: pollId },
    include: { eventType: { include: { invites: { orderBy: { createdAt: 'desc' }, take: 1 } } } },
  });
  if (!poll) throw new PollError('Not found', 404);
  const invite = poll.eventType.invites[0];
  const inviteLive =
    invite &&
    !invite.usedAt &&
    !invite.revokedAt &&
    (!invite.expiresAt || invite.expiresAt.getTime() > now.getTime());
  if (poll.status !== 'collecting' || !inviteLive) throw new PollError('This poll is closed.', 410);
  return poll;
}

/** The [from, to) window to read free/busy for, for a poll. */
export async function googleImportWindow(
  pollId: string,
  now: Date = new Date(),
): Promise<{ from: Date; to: Date }> {
  const poll = await db.groupPoll.findUnique({ where: { id: pollId }, include: { eventType: true } });
  if (!poll) throw new PollError('Not found', 404);
  return pollWindow(poll.eventType, now);
}

async function freeCandidates(pollId: string, busy: readonly BusyInterval[], now: Date): Promise<string[]> {
  const poll = await loadLivePoll(pollId, now);
  const owner = await loadOwner(poll.eventType);
  const candidates = flatten(await loadCandidates(poll.eventType, owner, 'UTC', now));
  return freeSlotsFromBusy(candidates, busy);
}

/**
 * Replace a participant's answer with "available" on every candidate slot
 * that doesn't overlap their Google busy blocks. Only the resulting votes
 * are kept — the busy blocks themselves are discarded. When Google shows no
 * free candidate at all, the existing answer is left alone.
 */
export async function applyGoogleBusy(
  participantId: string,
  busy: readonly BusyInterval[],
  now: Date = new Date(),
): Promise<{ availableSlots: number }> {
  const participant = await db.pollParticipant.findUnique({ where: { id: participantId } });
  if (!participant) throw new PollError('Not found', 404);
  const free = await freeCandidates(participant.pollId, busy, now);
  if (free.length === 0) return { availableSlots: 0 };

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

/**
 * Add someone whose first answer comes from Google: their free candidates
 * become "yes" votes. Nobody is added when Google shows no free candidate.
 * Returns the raw personal token for the new participant.
 */
export async function createParticipantFromGoogle(
  pollId: string,
  details: ParticipantDetails,
  busy: readonly BusyInterval[],
  now: Date = new Date(),
): Promise<{ availableSlots: number; participantToken: string | null }> {
  const free = await freeCandidates(pollId, busy, now);
  if (free.length === 0) return { availableSlots: 0, participantToken: null };
  const created = await insertParticipant({
    pollId,
    details,
    source: 'google',
    clientRequestHash: null,
    googleSyncedAt: now,
  });
  if (!created) throw new PollError('This poll is full.', 409);
  await replaceVotes(
    created.id,
    free.map((startUtc) => ({ startUtc, value: 'yes' as const })),
  );
  return { availableSlots: free.length, participantToken: created.token };
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
  const open = new Set(candidates.map((c) => c.startUtc));

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
      marked: p.votes.filter((v) => open.has(v.slotStart.toISOString())).length,
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
      // One booking per poll, even if the owner double-clicks or retries.
      clientRequestId: `poll-${poll.id}`,
      eventSummary: eventType.title,
      viaGroupPoll: true,
      // The poll closes in the same commit as the booking, so a failure can
      // never leave a booked meeting behind a poll that still collects.
      inTransaction: (tx, booking) => closePoll(tx, poll.id, booking.id),
    });
    bookingId = created.booking.id;
    needsSync = created.needsSync;
    if (created.idempotentReplay) {
      // The booking already existed; make sure its poll is closed too.
      await closePoll(db, poll.id, bookingId);
    }
  } catch (err) {
    if (err instanceof BookingError) {
      // A concurrent finalize for another time already booked this poll.
      if (err.code === 'IDEMPOTENCY_CONFLICT') throw new PollError('A time has already been picked.', 409);
      throw new PollError(err.message, err.httpStatus);
    }
    throw err;
  }

  logger.info(
    { event: 'poll.finalized', pollId: poll.id, bookingId, participants: poll.participants.length },
    'group poll finalized',
  );
  return { bookingId, needsSync };
}

/** Mark a poll finalized by `bookingId`. Already closed by that booking is fine. */
async function closePoll(tx: Prisma.TransactionClient, pollId: string, bookingId: string): Promise<void> {
  const closed = await tx.groupPoll.updateMany({
    where: { id: pollId, status: 'collecting' },
    data: { status: 'finalized', finalizedBookingId: bookingId },
  });
  if (closed.count === 1) return;
  const poll = await tx.groupPoll.findUnique({ where: { id: pollId }, select: { finalizedBookingId: true } });
  if (poll?.finalizedBookingId !== bookingId) {
    throw new PollError('A time has already been picked.', 409);
  }
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
