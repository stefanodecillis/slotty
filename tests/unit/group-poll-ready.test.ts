/**
 * "Tell me when everyone has answered" for group polls.
 *
 * Covers: expected participants and progress, the answer-by deadline (and
 * its scheduler sweep), becoming ready exactly once, the poll.ready webhook
 * with the best times, automatic booking only when a time works for
 * everyone, re-arming after an edit, and the owner's calendar data.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { randomBytes } from 'node:crypto';

import * as gcal from '@/lib/google/calendar';
import { encrypt } from '@/lib/crypto';
import {
  createOneTimeLink,
  getOneTimeLink,
  listOneTimeLinks,
  updateOneTimeLink,
} from '@/lib/one-time/service';
import { oneTimeLinkInputSchema } from '@/lib/one-time/validator';
import {
  checkPollDeadlines,
  checkPollReady,
  getPollResults,
  getPublicPollView,
  submitPollResponse,
} from '@/lib/group-poll/service';

const cleanups: Array<() => void> = [];
const DAY_MS = 86_400_000;

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.webhookDelivery.deleteMany({});
  await db.webhookEndpoint.deleteMany({});
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

function mockGoogle() {
  const insert = spyOn(gcal, 'insertEvent').mockImplementation(
    async () =>
      ({
        id: `g-${randomBytes(3).toString('hex')}`,
        hangoutLink: 'https://meet.google.com/x',
      }) as never,
  );
  cleanups.push(() => insert.mockRestore());
  return insert;
}

async function setup(groupPoll: Record<string, unknown> = {}) {
  const { db } = await import('@/lib/db');
  const user = await db.user.create({
    data: {
      username: `rd-${randomBytes(4).toString('hex')}`,
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
        create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          startMinute: 540,
          endMinute: 1020,
        })),
      },
    },
  });
  const endpoint = await db.webhookEndpoint.create({
    data: {
      userId: user.id,
      url: 'https://example.com/hook',
      secretEnc: encrypt('secret-secret'),
      eventTypesJson: JSON.stringify(['poll.ready']),
      active: true,
    },
  });
  const input = (poll: Record<string, unknown>) =>
    oneTimeLinkInputSchema.parse({
      title: 'Team sync',
      durationMinutes: 60,
      destinationAccountId: account.id,
      minNoticeMin: 0,
      bookingWindowDays: 7,
      slotIntervalMin: 60,
      groupPoll: { enabled: true, ...poll },
    });
  const created = await createOneTimeLink(user.id, input(groupPoll));
  const token = created.url.slice(created.url.lastIndexOf('/i/') + 3);
  const poll = await db.groupPoll.findUniqueOrThrow({
    where: { eventTypeId: created.eventTypeId },
  });
  const slots = (await getPublicPollView(token, 'UTC', null)).days.flatMap((d) => d.slots);
  return { db, user, created, token, poll, slots, endpoint, input };
}

function answer(name: string, starts: string[]) {
  return {
    name,
    email: `${name.toLowerCase()}@example.com`,
    timezone: 'UTC',
    votes: starts.map((startUtc) => ({ startUtc, value: 'yes' as const })),
  };
}

async function readyEvents(endpointId: string) {
  const { db } = await import('@/lib/db');
  const rows = await db.webhookDelivery.findMany({ where: { endpointId, event: 'poll.ready' } });
  return rows.map((r) => JSON.parse(r.payloadJson) as { data: Record<string, unknown> });
}

describe('poll ready', () => {
  it('becomes ready once everyone expected has answered, and tells the owner once', async () => {
    const { db, user, created, token, poll, slots, endpoint } = await setup({
      expected: ['Ann@example.com', 'bob@example.com'],
    });
    await submitPollResponse(token, answer('Ann', [slots[0]!.startUtc, slots[1]!.startUtc]), null);
    expect((await db.groupPoll.findUniqueOrThrow({ where: { id: poll.id } })).readyAt).toBeNull();
    let [item] = await listOneTimeLinks(user.id);
    expect(item?.groupPoll).toMatchObject({ expected: 2, expectedAnswered: 1, readyAt: null });
    let results = await getPollResults(user.id, created.eventTypeId);
    expect(results.expected).toEqual([
      { email: 'ann@example.com', answered: true },
      { email: 'bob@example.com', answered: false },
    ]);

    // Someone unexpected doesn't count; Bob does.
    await submitPollResponse(token, answer('Cy', [slots[1]!.startUtc]), null);
    expect(await readyEvents(endpoint.id)).toHaveLength(0);
    await submitPollResponse(token, answer('Bob', [slots[1]!.startUtc]), null);

    expect(
      (await db.groupPoll.findUniqueOrThrow({ where: { id: poll.id } })).readyAt,
    ).not.toBeNull();
    [item] = await listOneTimeLinks(user.id);
    expect(item?.groupPoll).toMatchObject({ expected: 2, expectedAnswered: 2 });
    expect(item?.groupPoll?.readyAt).toBeTruthy();

    const events = await readyEvents(endpoint.id);
    expect(events).toHaveLength(1);
    const data = events[0]!.data;
    expect(data).toMatchObject({
      reason: 'everyone_answered',
      respondents: 3,
      expected: { total: 2, answered: 2 },
      autoBooked: false,
      bookingId: null,
    });
    expect((data.bestTimes as { startAt: string; no: number }[])[0]).toMatchObject({
      startAt: slots[1]!.startUtc,
      no: 0,
    });
    expect(String(data.answersUrl)).toContain(`/admin/event-types?answers=${created.eventTypeId}`);

    // Later answers or checks don't announce it again.
    await submitPollResponse(token, answer('Dee', [slots[2]!.startUtc]), null);
    expect(await checkPollReady(poll.id)).toBeNull();
    expect(await readyEvents(endpoint.id)).toHaveLength(1);

    results = await getPollResults(user.id, created.eventTypeId);
    expect(results.readyAt).toBeTruthy();
    expect(results.slots).toHaveLength(results.candidateCount);
  });

  it('becomes ready when the deadline passes with at least one answer (scheduler sweep)', async () => {
    const { db, token, poll, slots, endpoint } = await setup({
      answerBy: new Date(Date.now() + DAY_MS).toISOString(),
    });
    expect(await checkPollDeadlines(new Date(Date.now() + 2 * DAY_MS))).toBe(0); // nobody answered
    // A time still open two days from now (votes on times that have passed don't count).
    await submitPollResponse(token, answer('Ann', [slots[slots.length - 1]!.startUtc]), null);
    expect(await checkPollDeadlines()).toBe(0); // not due yet
    expect(await checkPollDeadlines(new Date(Date.now() + 2 * DAY_MS))).toBe(1);
    expect(
      (await db.groupPoll.findUniqueOrThrow({ where: { id: poll.id } })).readyAt,
    ).not.toBeNull();
    expect((await readyEvents(endpoint.id))[0]?.data.reason).toBe('deadline');
  });

  it('books the best time automatically only when it works for everyone who answered', async () => {
    const insert = mockGoogle();
    const { db, created, token, poll, slots } = await setup({
      expected: ['ann@example.com', 'bob@example.com'],
      autoBook: true,
    });
    await submitPollResponse(token, answer('Ann', [slots[0]!.startUtc, slots[2]!.startUtc]), null);
    await submitPollResponse(token, answer('Bob', [slots[1]!.startUtc, slots[2]!.startUtc]), null);

    const done = await db.groupPoll.findUniqueOrThrow({ where: { id: poll.id } });
    expect(done.status).toBe('finalized');
    const booking = await db.booking.findUniqueOrThrow({ where: { id: done.finalizedBookingId! } });
    expect(booking.startAt.toISOString()).toBe(slots[2]!.startUtc);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(created.eventTypeId).toBe(booking.eventTypeId);
  });

  it('only tells the owner when no time works for everyone, even with auto-book on', async () => {
    mockGoogle();
    const { db, token, poll, slots, endpoint } = await setup({
      expected: ['ann@example.com', 'bob@example.com'],
      autoBook: true,
    });
    await submitPollResponse(token, answer('Ann', [slots[0]!.startUtc]), null);
    await submitPollResponse(token, answer('Bob', [slots[1]!.startUtc]), null);
    const after = await db.groupPoll.findUniqueOrThrow({ where: { id: poll.id } });
    expect(after.status).toBe('collecting');
    expect(after.readyAt).not.toBeNull();
    expect(await db.booking.count()).toBe(0);
    expect((await readyEvents(endpoint.id))[0]?.data).toMatchObject({ autoBooked: false });
  });

  it('re-arms after the owner edits who is expected, and can be ready right away', async () => {
    const { db, user, created, token, poll, slots, input } = await setup({
      expected: ['ann@example.com'],
    });
    await submitPollResponse(token, answer('Ann', [slots[0]!.startUtc]), null);
    await submitPollResponse(token, answer('Bob', [slots[0]!.startUtc]), null);
    expect(
      (await db.groupPoll.findUniqueOrThrow({ where: { id: poll.id } })).readyAt,
    ).not.toBeNull();

    // Now Cy is expected too: not ready any more.
    await updateOneTimeLink(
      user.id,
      created.eventTypeId,
      input({ expected: ['ann@example.com', 'cy@example.com'] }),
    );
    expect((await db.groupPoll.findUniqueOrThrow({ where: { id: poll.id } })).readyAt).toBeNull();
    expect((await getOneTimeLink(user.id, created.eventTypeId)).values.groupPoll.expected).toEqual([
      'ann@example.com',
      'cy@example.com',
    ]);

    // Swap Cy for Bob, who already answered: ready straight after the edit.
    await updateOneTimeLink(
      user.id,
      created.eventTypeId,
      input({ expected: ['ann@example.com', 'bob@example.com'] }),
    );
    expect(
      (await db.groupPoll.findUniqueOrThrow({ where: { id: poll.id } })).readyAt,
    ).not.toBeNull();
  });
});
