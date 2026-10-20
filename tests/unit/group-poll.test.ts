/**
 * Group availability polls ("A group" one-time invitations).
 *
 * Covers:
 *   - ranking / free-busy helpers (pure);
 *   - creating, editing and switching an invitation into and out of group mode;
 *   - participants answering, editing via their personal token, votes
 *     outside the candidates dropped, names hidden on request, emails not
 *     revealed through a "taken" error, the participant cap under races;
 *   - the link can't be booked directly; the owner finalizes instead, which
 *     books one meeting for everyone and closes the poll in the same commit;
 *   - the Google free/busy round-trip (public redirect URI, freebusy-only
 *     scope, state binding, busy → votes, nothing stored or revoked).
 *
 * Google I/O is mocked at the wrapper layer like the other booking tests.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';

import * as gcal from '@/lib/google/calendar';
import * as participantOAuth from '@/lib/google/participant-oauth';
import { BookingError, createBooking } from '@/lib/booking/create';
import { createOneTimeLink, getOneTimeLink, listOneTimeLinks, updateOneTimeLink } from '@/lib/one-time/service';
import { oneTimeLinkInputSchema, type OneTimeLinkInput } from '@/lib/one-time/validator';
import {
  finalizePoll,
  getPollResults,
  getPublicPollView,
  PollError,
  removePollParticipant,
  submitPollResponse,
} from '@/lib/group-poll/service';
import { completeGoogleImport, startGoogleImport } from '@/lib/group-poll/google-flow';
import { decodeSpans, encodeSpans, GOOGLE_FREE_PARAM, slotsWithinSpans, spansFromSlots } from '@/lib/group-poll/prefill';
import { freeSlotsFromBusy, rankSlots, tallySlots } from '@/lib/group-poll/rank';
import { MAX_POLL_PARTICIPANTS, MAX_POLL_VOTES, pollResponseSchema } from '@/lib/group-poll/validator';

const cleanups: Array<() => void> = [];

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.pollVote.deleteMany({});
  await db.pollParticipant.deleteMany({});
  await db.groupPoll.deleteMany({});
  await db.bookingHistory.deleteMany({});
  await db.bookingInvite.deleteMany({});
  await db.booking.deleteMany({});
  await db.job.deleteMany({});
  await db.busyEvent.deleteMany({});
  await db.dateOverride.deleteMany({});
  await db.scheduleRule.deleteMany({});
  await db.eventTypeQuestion.deleteMany({});
  await db.eventType.deleteMany({});
  await db.schedule.deleteMany({});
  await db.calendar.deleteMany({});
  await db.connectedAccount.deleteMany({});
  await db.session.deleteMany({});
  await db.user.deleteMany({});
});

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function seed() {
  const { db } = await import('@/lib/db');
  const user = await db.user.create({
    data: {
      username: `gp-${randomBytes(4).toString('hex')}`,
      passwordHash: 'placeholder',
      email: 'owner@example.com',
      displayName: 'Owner',
      timezone: 'UTC',
    },
  });
  const account = await db.connectedAccount.create({
    data: {
      provider: 'google',
      googleUserEmail: `acc-${randomBytes(4).toString('hex')}@example.com`,
      accessTokenEnc: 'x',
      refreshTokenEnc: 'x',
      scopes: 'calendar',
      expiresAt: new Date(Date.now() + 3600_000),
      status: 'active',
    },
  });
  await db.calendar.create({
    data: {
      connectedAccountId: account.id,
      googleCalendarId: account.googleUserEmail,
      name: 'Primary',
      isPrimary: true,
      isBusySource: true,
      timezone: 'UTC',
    },
  });
  await db.schedule.create({
    data: {
      userId: user.id,
      name: 'Default',
      isDefault: true,
      timezone: 'UTC',
      rules: {
        create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })),
      },
    },
  });
  return { user, account };
}

function input(accountId: string, overrides: Record<string, unknown> = {}): OneTimeLinkInput {
  return oneTimeLinkInputSchema.parse({
    title: 'Team sync',
    durationMinutes: 60,
    destinationAccountId: accountId,
    minNoticeMin: 0,
    bookingWindowDays: 7,
    slotIntervalMin: 60,
    groupPoll: { enabled: true },
    ...overrides,
  });
}

function tokenFromUrl(url: string): string {
  return url.slice(url.lastIndexOf('/i/') + 3);
}

function mockGoogle() {
  const insert = spyOn(gcal, 'insertEvent').mockImplementation(
    async () =>
      ({ id: `g-${randomBytes(3).toString('hex')}`, hangoutLink: 'https://meet.google.com/x' }) as never,
  );
  cleanups.push(() => insert.mockRestore());
  return insert;
}

async function setupPoll(overrides: Record<string, unknown> = {}) {
  const { user, account } = await seed();
  const created = await createOneTimeLink(user.id, input(account.id, overrides));
  const token = tokenFromUrl(created.url);
  const view = await getPublicPollView(token, 'UTC', null);
  const slots = view.days.flatMap((d) => d.slots);
  expect(slots.length).toBeGreaterThan(3);
  return { user, account, created, token, slots };
}

function answer(name: string, votes: { startUtc: string; value: 'yes' | 'maybe' }[]) {
  return { name, email: `${name.toLowerCase()}@example.com`, timezone: 'UTC', votes };
}

describe('rank helpers', () => {
  const c = (h: number) => ({
    startUtc: `2030-01-01T${String(h).padStart(2, '0')}:00:00.000Z`,
    endUtc: `2030-01-01T${String(h + 1).padStart(2, '0')}:00:00.000Z`,
  });

  it('puts slots everyone can make first, then more clear yeses, then earlier', () => {
    const slots = [c(9), c(10), c(11), c(12)];
    const ranked = rankSlots(
      tallySlots(slots, [
        { id: 'a', votes: new Map([[c(9).startUtc, 'yes'], [c(10).startUtc, 'maybe'], [c(11).startUtc, 'yes']]) },
        { id: 'b', votes: new Map([[c(10).startUtc, 'yes'], [c(11).startUtc, 'yes']]) },
      ]),
    );
    expect(ranked.map((t) => t.startUtc)).toEqual([c(11).startUtc, c(10).startUtc, c(9).startUtc]);
    expect(ranked[2]!.no).toEqual(['b']);
  });

  it('turns busy blocks into the slots that are still free', () => {
    const free = freeSlotsFromBusy([c(9), c(10), c(11)], [
      { start: new Date('2030-01-01T09:30:00Z'), end: new Date('2030-01-01T10:00:00Z') },
    ]);
    expect(free).toEqual([c(10).startUtc, c(11).startUtc]);
  });

  it('only accepts Google redirect URIs on HTTPS domains or loopback', () => {
    expect(participantOAuth.isGoogleRedirectEligible('https://book.example.com')).toBe(true);
    expect(participantOAuth.isGoogleRedirectEligible('http://localhost:3000')).toBe(true);
    expect(participantOAuth.isGoogleRedirectEligible('http://book.example.com')).toBe(false);
    expect(participantOAuth.isGoogleRedirectEligible('http://truenas:3210')).toBe(false);
    expect(participantOAuth.isGoogleRedirectEligible('https://192.168.1.10')).toBe(false);
  });
});

describe('group invitations', () => {
  it('creates a poll and lets every participant be invited', async () => {
    const { db } = await import('@/lib/db');
    const { user, created } = await setupPoll({ groupPoll: { enabled: true, showNames: false } });

    const poll = await db.groupPoll.findUniqueOrThrow({ where: { eventTypeId: created.eventTypeId } });
    expect(poll.status).toBe('collecting');
    expect(poll.showNames).toBe(false);
    const et = await db.eventType.findUniqueOrThrow({ where: { id: created.eventTypeId } });
    expect(et.maxGuests).toBe(14);

    const detail = await getOneTimeLink(user.id, created.eventTypeId);
    expect(detail.values.groupPoll).toEqual({
      enabled: true,
      showNames: false,
      allowGoogle: true,
      expected: [],
      answerBy: null,
      autoBook: false,
    });
    const [item] = await listOneTimeLinks(user.id);
    expect(item?.groupPoll).toEqual({ responses: 0, expected: 0, expectedAnswered: 0, readyAt: null });
  });

  it('rejects a poll window longer than 31 days', () => {
    const parsed = oneTimeLinkInputSchema.safeParse({
      title: 'x',
      destinationAccountId: 'a',
      bookingWindowDays: 60,
      groupPoll: { enabled: true },
    });
    expect(parsed.success).toBe(false);
  });

  it('can be switched off only while nobody has answered', async () => {
    const { db } = await import('@/lib/db');
    const { user, account, created, token, slots } = await setupPoll();

    // Nobody answered → switching off removes the poll.
    await updateOneTimeLink(user.id, created.eventTypeId, input(account.id, { groupPoll: { enabled: false } }));
    expect(await db.groupPoll.count()).toBe(0);

    await updateOneTimeLink(user.id, created.eventTypeId, input(account.id));
    await submitPollResponse(token, answer('Ann', [{ startUtc: slots[0]!.startUtc, value: 'yes' }]), null);
    await expect(
      updateOneTimeLink(user.id, created.eventTypeId, input(account.id, { groupPoll: { enabled: false } })),
    ).rejects.toThrow(/already answered/);
  });
});

describe('participants', () => {
  it('records answers and edits through the personal token', async () => {
    const { token, slots } = await setupPoll();
    const s0 = slots[0]!.startUtc;
    const s1 = slots[1]!.startUtc;

    const first = await submitPollResponse(
      token,
      answer('Ann', [
        { startUtc: s0, value: 'yes' },
        { startUtc: '2001-01-01T09:00:00.000Z', value: 'yes' }, // not a candidate → dropped
      ]),
      null,
    );
    expect(first.participantToken).toBeTruthy();

    // With the token the answer is replaced.
    await submitPollResponse(token, answer('Ann', [{ startUtc: s1, value: 'maybe' }]), first.participantToken);
    const view = await getPublicPollView(token, 'UTC', first.participantToken);
    expect(view.me?.votes).toEqual([{ startUtc: s1, value: 'maybe' }]);
    expect(view.respondents).toEqual({ count: 1, names: ['Ann'] });
    expect(view.tally[s1]).toEqual({ yes: 0, maybe: 1, yesNames: [], maybeNames: ['Ann'] });
    expect(view.tally[s0]).toBeUndefined();

    // A token from somewhere else is rejected rather than silently ignored.
    await expect(getPublicPollView(token, 'UTC', 'not-a-token')).rejects.toBeInstanceOf(PollError);
  });

  it('hides names when the owner asked to', async () => {
    const { token, slots } = await setupPoll({ groupPoll: { enabled: true, showNames: false } });
    await submitPollResponse(token, answer('Ann', [{ startUtc: slots[0]!.startUtc, value: 'yes' }]), null);
    const view = await getPublicPollView(token, 'UTC', null);
    expect(view.respondents).toEqual({ count: 1, names: null });
    expect(view.tally[slots[0]!.startUtc]).toEqual({ yes: 1, maybe: 0 });
  });

  it("doesn't reveal who answered: a reused email is a new answer", async () => {
    const { user, created, token, slots } = await setupPoll({ groupPoll: { enabled: true, showNames: false } });
    const s0 = slots[0]!.startUtc;
    const first = await submitPollResponse(token, answer('Ann', [{ startUtc: s0, value: 'yes' }]), null);
    const probe = await submitPollResponse(token, answer('Ann', [{ startUtc: s0, value: 'maybe' }]), null);
    expect(probe.participantToken).toBeTruthy();
    expect(probe.participantId).not.toBe(first.participantId);

    // The first answer is untouched, and the owner sees both.
    const view = await getPublicPollView(token, 'UTC', first.participantToken);
    expect(view.me?.votes).toEqual([{ startUtc: s0, value: 'yes' }]);
    const results = await getPollResults(user.id, created.eventTypeId);
    expect(results.participants.map((p) => p.email)).toEqual(['ann@example.com', 'ann@example.com']);
    // Rows from the raw conditional insert read back like Prisma-created ones.
    expect(results.participants[0]!.source).toBe('manual');
    expect(Math.abs(Date.parse(results.participants[0]!.updatedAt) - Date.now())).toBeLessThan(60_000);
  });

  it('never lets concurrent first saves overshoot the participant cap', async () => {
    const { db } = await import('@/lib/db');
    const { token, slots } = await setupPoll();
    const one = [{ startUtc: slots[0]!.startUtc, value: 'yes' as const }];
    const attempts = MAX_POLL_PARTICIPANTS + 5;
    const outcomes = await Promise.allSettled(
      Array.from({ length: attempts }, (_, i) => submitPollResponse(token, answer(`P${i}`, one), null)),
    );
    const ok = outcomes.filter((o) => o.status === 'fulfilled').length;
    const full = outcomes.filter(
      (o) => o.status === 'rejected' && o.reason instanceof PollError && /full/.test(o.reason.message),
    ).length;
    expect(ok).toBe(MAX_POLL_PARTICIPANTS);
    expect(full).toBe(attempts - MAX_POLL_PARTICIPANTS);
    expect(await db.pollParticipant.count()).toBe(MAX_POLL_PARTICIPANTS);
  });

  it('refuses a new answer once the poll is full, without leaving a row behind', async () => {
    const { db } = await import('@/lib/db');
    const { token, slots } = await setupPoll();
    const one = [{ startUtc: slots[0]!.startUtc, value: 'yes' as const }];
    for (let i = 0; i < MAX_POLL_PARTICIPANTS; i++) {
      await submitPollResponse(token, answer(`P${i}`, one), null);
    }
    await expect(submitPollResponse(token, answer('Late', one), null)).rejects.toThrow(/full/);
    expect(await db.pollParticipant.count({ where: { email: 'late@example.com' } })).toBe(0);
  });

  it('accepts a fully painted grid at the finest interval and longest window', () => {
    const votes = Array.from({ length: MAX_POLL_VOTES }, (_, i) => ({
      startUtc: new Date(Date.UTC(2030, 0, 1) + i * 5 * 60_000).toISOString(),
      value: 'yes' as const,
    }));
    expect(pollResponseSchema.safeParse(answer('Ann', votes)).success).toBe(true);
    expect(MAX_POLL_VOTES).toBeGreaterThanOrEqual(32 * 24 * 12);
  });

  it('rejects group polls with slots finer than the vote cap allows', () => {
    const parsed = oneTimeLinkInputSchema.safeParse({
      title: 'Team sync',
      destinationAccountId: 'acc',
      slotIntervalMin: 1,
      groupPoll: { enabled: true },
    });
    expect(parsed.success).toBe(false);
  });

  it('cannot be booked directly through the link', async () => {
    const { token, slots } = await setupPoll();
    const err = await createBooking({
      inviteToken: token,
      startAtIso: slots[0]!.startUtc,
      bookerName: 'Mallory',
      bookerEmail: 'mallory@example.com',
      bookerTimezone: 'UTC',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BookingError);
    expect((err as BookingError).code).toBe('GROUP_POLL');
  });

  it('reports a spent poll link as unavailable, not as a poll to answer', async () => {
    mockGoogle();
    const { user, created, token, slots } = await setupPoll();
    const start = slots[0]!.startUtc;
    await submitPollResponse(token, answer('Ann', [{ startUtc: start, value: 'yes' }]), null);
    await finalizePoll(user.id, created.eventTypeId, start);

    const { db } = await import('@/lib/db');
    const poll = await db.groupPoll.findUniqueOrThrow({ where: { eventTypeId: created.eventTypeId } });
    const err = await createBooking({
      inviteToken: token,
      startAtIso: start,
      bookerName: 'Mallory',
      bookerEmail: 'mallory@example.com',
      bookerTimezone: 'UTC',
      // Even with the poll's own request id, the public path doesn't replay it.
      clientRequestId: `poll-${poll.id}`,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BookingError);
    expect((err as BookingError).code).toBe('INVITE_UNAVAILABLE');
  });
});

describe('finalizePoll', () => {
  it('books the common time for everyone and closes the poll', async () => {
    const { db } = await import('@/lib/db');
    const insert = mockGoogle();
    const { user, created, token, slots } = await setupPoll();
    const common = slots[2]!.startUtc;

    await submitPollResponse(token, answer('Ann', [{ startUtc: slots[0]!.startUtc, value: 'yes' }, { startUtc: common, value: 'maybe' }]), null);
    await submitPollResponse(token, answer('Bob', [{ startUtc: common, value: 'yes' }]), null);
    await submitPollResponse(token, answer('Cy', [{ startUtc: common, value: 'yes' }]), null);

    const results = await getPollResults(user.id, created.eventTypeId);
    expect(results.ranked[0]!.startUtc).toBe(common);
    expect(results.ranked[0]!.no).toEqual([]);

    const { bookingId } = await finalizePoll(user.id, created.eventTypeId, common);
    const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.startAt.toISOString()).toBe(common);
    // First clear "yes" books; everyone else who answered is a guest.
    expect(booking.bookerEmail).toBe('bob@example.com');
    expect(JSON.parse(booking.additionalGuestsJson).sort()).toEqual(['ann@example.com', 'cy@example.com']);

    const payload = insert.mock.calls[0]![2] as { summary?: string; attendees?: { email?: string }[] };
    expect(payload.summary).toBe('Team sync');
    expect(payload.attendees?.map((a) => a.email)).toContain('ann@example.com');

    const poll = await db.groupPoll.findUniqueOrThrow({ where: { eventTypeId: created.eventTypeId } });
    expect(poll.status).toBe('finalized');
    expect(poll.finalizedBookingId).toBe(bookingId);

    // The link is consumed: no more answers, and the invitation shows as booked.
    await expect(submitPollResponse(token, answer('Dee', []), null)).rejects.toThrow(/closed/);
    const [item] = await listOneTimeLinks(user.id);
    expect(item?.status).toBe('booked');
    await expect(finalizePoll(user.id, created.eventTypeId, common)).rejects.toThrow(/already/);
  });

  it('rolls the booking back when closing the poll fails', async () => {
    const { db } = await import('@/lib/db');
    mockGoogle();
    const { created, token, slots } = await setupPoll();
    const err = await createBooking({
      inviteToken: token,
      startAtIso: slots[0]!.startUtc,
      bookerName: 'Ann',
      bookerEmail: 'ann@example.com',
      bookerTimezone: 'UTC',
      viaGroupPoll: true,
      inTransaction: async () => {
        throw new Error('boom');
      },
    }).catch((e) => e);
    expect((err as Error).message).toBe('boom');
    expect(await db.booking.count()).toBe(0);
    const invite = await db.bookingInvite.findFirstOrThrow({ where: { eventTypeId: created.eventTypeId } });
    expect(invite.usedAt).toBeNull();
  });

  it('closes a poll whose booking was made but never recorded on it', async () => {
    const { db } = await import('@/lib/db');
    mockGoogle();
    const { user, created, token, slots } = await setupPoll();
    const start = slots[1]!.startUtc;
    await submitPollResponse(token, answer('Ann', [{ startUtc: start, value: 'yes' }]), null);
    const poll = await db.groupPoll.findUniqueOrThrow({ where: { eventTypeId: created.eventTypeId } });

    // The state an interrupted finalize used to leave behind: the meeting is
    // booked and the invite consumed, but the poll still collects.
    const orphan = await createBooking({
      inviteToken: token,
      startAtIso: start,
      bookerName: 'Ann',
      bookerEmail: 'ann@example.com',
      bookerTimezone: 'UTC',
      clientRequestId: `poll-${poll.id}`,
      viaGroupPoll: true,
    });

    const retried = await finalizePoll(user.id, created.eventTypeId, start);
    expect(retried.bookingId).toBe(orphan.booking.id);
    expect(await db.booking.count()).toBe(1);
    const closed = await db.groupPoll.findUniqueOrThrow({ where: { id: poll.id } });
    expect(closed.status).toBe('finalized');
    expect(closed.finalizedBookingId).toBe(orphan.booking.id);
  });

  it('invites a repeated email only once', async () => {
    const { db } = await import('@/lib/db');
    mockGoogle();
    const { user, created, token, slots } = await setupPoll();
    const start = slots[0]!.startUtc;
    await submitPollResponse(token, answer('Ann', [{ startUtc: start, value: 'yes' }]), null);
    await submitPollResponse(token, answer('Bob', [{ startUtc: start, value: 'yes' }]), null);
    await submitPollResponse(token, answer('Bob', [{ startUtc: slots[1]!.startUtc, value: 'yes' }]), null);
    const { bookingId } = await finalizePoll(user.id, created.eventTypeId, start);
    const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.bookerEmail).toBe('ann@example.com');
    expect(JSON.parse(booking.additionalGuestsJson)).toEqual(['bob@example.com']);
  });

  it('refuses to book before anyone answered', async () => {
    const { user, created, slots } = await setupPoll();
    await expect(finalizePoll(user.id, created.eventTypeId, slots[0]!.startUtc)).rejects.toThrow(/Nobody/);
  });

  it('lets the owner remove an answer', async () => {
    const { user, created, token, slots } = await setupPoll();
    await submitPollResponse(token, answer('Spam', [{ startUtc: slots[0]!.startUtc, value: 'yes' }]), null);
    const results = await getPollResults(user.id, created.eventTypeId);
    await removePollParticipant(user.id, created.eventTypeId, results.participants[0]!.id);
    expect((await getPollResults(user.id, created.eventTypeId)).participants).toHaveLength(0);
  });
});

describe('an answer always marks a time', () => {
  it('refuses an empty answer and saves nothing', async () => {
    const { db } = await import('@/lib/db');
    const { token } = await setupPoll();
    const err = await submitPollResponse(token, answer('Ann', []), null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PollError);
    expect((err as PollError).status).toBe(422);
    expect((err as PollError).message).toMatch(/at least one time/);
    expect(await db.pollParticipant.count()).toBe(0);
  });

  it('refuses an answer whose times are all gone, and free ranges that cover no time', async () => {
    const { db } = await import('@/lib/db');
    const { token, slots } = await setupPoll();
    await expect(
      submitPollResponse(token, answer('Ann', [{ startUtc: '2001-01-01T09:00:00.000Z', value: 'yes' }]), null),
    ).rejects.toThrow(/no longer open/);
    const half = new Date(Date.parse(slots[0]!.startUtc) + 30 * 60_000).toISOString();
    await expect(
      submitPollResponse(
        token,
        { ...answer('Ann', []), votes: undefined, available: [{ start: slots[0]!.startUtc, end: half, value: 'yes' }] },
        null,
      ),
    ).rejects.toThrow(/covers a whole candidate/);
    expect(await db.pollParticipant.count()).toBe(0);
  });

  it("won't clear an existing answer", async () => {
    const { token, slots } = await setupPoll();
    const me = await submitPollResponse(token, answer('Ann', [{ startUtc: slots[0]!.startUtc, value: 'yes' }]), null);
    await expect(submitPollResponse(token, answer('Ann', []), me.participantToken)).rejects.toThrow(/at least one time/);
    const view = await getPublicPollView(token, 'UTC', me.participantToken);
    expect(view.me!.votes).toEqual([{ startUtc: slots[0]!.startUtc, value: 'yes' }]);
  });

  it('shows the owner how many current times each answer marks', async () => {
    const { db } = await import('@/lib/db');
    const { user, created, token, slots } = await setupPoll();
    await submitPollResponse(
      token,
      answer('Ann', [
        { startUtc: slots[0]!.startUtc, value: 'yes' },
        { startUtc: slots[1]!.startUtc, value: 'maybe' },
      ]),
      null,
    );
    // An empty answer saved before this rule existed.
    const poll = await db.groupPoll.findUniqueOrThrow({ where: { eventTypeId: created.eventTypeId } });
    await db.pollParticipant.create({
      data: { pollId: poll.id, name: 'Old', email: 'old@example.com', timezone: 'UTC', editTokenHash: 'x' },
    });
    const results = await getPollResults(user.id, created.eventTypeId);
    expect(results.participants.map((p) => [p.name, p.marked])).toEqual([
      ['Ann', 2],
      ['Old', 0],
    ]);
  });
});

describe('Google free/busy import', () => {
  it('uses the public redirect URI and only the free/busy scope', async () => {
    const { token } = await setupPoll();
    const { authUrl } = await startGoogleImport({ inviteToken: token });
    const url = new URL(authUrl);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/public/polls/google/callback');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.freebusy');
    expect(url.searchParams.get('access_type')).toBe('online');
  });

  function mockBusy(busy: { start: Date; end: Date }[]) {
    const fetchBusy = spyOn(participantOAuth, 'fetchParticipantBusy').mockResolvedValue(busy);
    cleanups.push(() => fetchBusy.mockRestore());
    return fetchBusy;
  }

  async function roundTrip(token: string) {
    const { authUrl, cookieValue } = await startGoogleImport({ inviteToken: token });
    const state = new URL(authUrl).searchParams.get('state');
    return completeGoogleImport({ code: 'c', state, oauthError: null, cookieValue });
  }

  it('hands the free times back to the browser to pre-fill, and saves nothing', async () => {
    const { db } = await import('@/lib/db');
    const { token, slots } = await setupPoll();
    const busySlot = slots[1]!;
    mockBusy([{ start: new Date(busySlot.startUtc), end: new Date(busySlot.endUtc) }]);

    const out = await roundTrip(token);
    expect(out.outcome).toBe('ok');
    const back = new URL(out.redirectPath, 'http://x');
    expect(back.pathname).toBe(`/i/${token}`);
    expect(back.searchParams.get('google')).toBe('ok');
    // Only in the fragment, which the browser never sends to a server.
    expect(back.search).not.toContain(GOOGLE_FREE_PARAM);
    const spans = decodeSpans(new URLSearchParams(back.hash.slice(1)).get(GOOGLE_FREE_PARAM));
    const prefilled = slotsWithinSpans(slots, spans).map((s) => s.startUtc);
    expect(prefilled).toHaveLength(slots.length - 1);
    expect(prefilled).not.toContain(busySlot.startUtc);

    // Nothing is stored: no answer, nothing from Google.
    expect(await db.pollParticipant.count()).toBe(0);
    expect(await db.connectedAccount.count()).toBe(1);
  });

  it('leaves an existing answer alone until the participant saves', async () => {
    const { token, slots } = await setupPoll();
    const me = await submitPollResponse(token, answer('Ann', [{ startUtc: slots[0]!.startUtc, value: 'maybe' }]), null);
    mockBusy([]);
    expect((await roundTrip(token)).outcome).toBe('ok');
    let view = await getPublicPollView(token, 'UTC', me.participantToken);
    expect(view.me!.votes).toEqual([{ startUtc: slots[0]!.startUtc, value: 'maybe' }]);

    // Saving the pre-filled grid labels the answer as coming from Google.
    await submitPollResponse(
      token,
      { ...answer('Ann', slots.map((s) => ({ startUtc: s.startUtc, value: 'yes' as const }))), via: 'google' },
      me.participantToken,
    );
    view = await getPublicPollView(token, 'UTC', me.participantToken);
    expect(view.me!.votes).toHaveLength(slots.length);
    expect(view.me!.source).toBe('google');
    expect(view.me!.googleSyncedAt).toBeTruthy();
  });

  it('reports no free time, and an abandoned or denied import, without saving anything', async () => {
    const { db } = await import('@/lib/db');
    const { token, slots } = await setupPoll();
    mockBusy([{ start: new Date(slots[0]!.startUtc), end: new Date(Date.now() + 365 * 86_400_000) }]);
    expect(await roundTrip(token)).toEqual({ redirectPath: `/i/${token}?google=empty`, outcome: 'empty' });
    const { cookieValue } = await startGoogleImport({ inviteToken: token });
    expect(
      (await completeGoogleImport({ code: null, state: null, oauthError: 'access_denied', cookieValue })).outcome,
    ).toBe('denied');
    expect(await db.pollParticipant.count()).toBe(0);
  });

  it('round-trips free spans compactly', () => {
    const spans = spansFromSlots([
      { startUtc: '2030-01-01T09:00:00.000Z', endUtc: '2030-01-01T10:00:00.000Z' },
      { startUtc: '2030-01-01T09:15:00.000Z', endUtc: '2030-01-01T10:15:00.000Z' },
      { startUtc: '2030-01-01T14:00:00.000Z', endUtc: '2030-01-01T15:00:00.000Z' },
    ]);
    expect(spans).toHaveLength(2);
    expect(decodeSpans(encodeSpans(spans))).toEqual(spans);
    expect(decodeSpans('garbage,1-0,12-x')).toEqual([]);
  });

  it("reads free/busy once and doesn't revoke the shared client's grant", async () => {
    const OAuth2 = google.auth.OAuth2.prototype;
    const getToken = spyOn(OAuth2, 'getToken').mockResolvedValue({ tokens: { access_token: 'at' }, res: null } as never);
    const revoke = spyOn(OAuth2, 'revokeToken').mockResolvedValue({} as never);
    const query = async () => ({
      data: { calendars: { primary: { busy: [{ start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z' }] } } },
    });
    const calendar = spyOn(google, 'calendar').mockReturnValue({ freebusy: { query } } as never);
    cleanups.push(() => {
      getToken.mockRestore();
      revoke.mockRestore();
      calendar.mockRestore();
    });

    const busy = await participantOAuth.fetchParticipantBusy('c', new Date('2030-01-01'), new Date('2030-01-02'));
    expect(busy).toEqual([{ start: new Date('2030-01-01T10:00:00Z'), end: new Date('2030-01-01T11:00:00Z') }]);
    // Revoking would also drop the owner's refresh token when they import
    // with the Google account Slotty is connected to.
    expect(revoke).not.toHaveBeenCalled();
  });

  it('rejects a mismatched state and reports a denied consent', async () => {
    const { token } = await setupPoll();
    const { cookieValue } = await startGoogleImport({ inviteToken: token });
    const fetchBusy = mockBusy([]);

    expect((await completeGoogleImport({ code: 'c', state: 'forged', oauthError: null, cookieValue })).outcome).toBe('failed');
    expect((await completeGoogleImport({ code: null, state: null, oauthError: 'access_denied', cookieValue })).outcome).toBe('denied');
    expect((await completeGoogleImport({ code: 'c', state: 'x', oauthError: null, cookieValue: 'garbage' })).redirectPath).toBe('/');
    expect(fetchBusy).not.toHaveBeenCalled();
  });

  it('is refused when the owner turned it off', async () => {
    const { token } = await setupPoll({ groupPoll: { enabled: true, allowGoogle: false } });
    await expect(startGoogleImport({ inviteToken: token })).rejects.toThrow(/not available/);
    expect((await getPublicPollView(token, 'UTC', null)).google.enabled).toBe(false);
  });
});
