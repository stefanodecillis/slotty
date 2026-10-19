import { http } from './http';
import type { AdminPollResults, PublicPollView } from '@/lib/group-poll/service';
import type { VoteValue } from '@/lib/group-poll/rank';

export type { AdminPollResults, PublicPollView, VoteValue };

// ─────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────

export const pollKeys = {
  all: ['groupPoll'] as const,
  results: (eventTypeId: string) => [...pollKeys.all, 'results', eventTypeId] as const,
  public: (inviteToken: string, tz: string, participantToken: string | null) =>
    [...pollKeys.all, 'public', inviteToken, tz, participantToken ?? ''] as const,
};

export function getPollResults(eventTypeId: string): Promise<AdminPollResults> {
  return http(`/api/admin/one-time-links/${eventTypeId}/poll`);
}

export function finalizePoll(
  eventTypeId: string,
  startUtc: string,
): Promise<{ bookingId: string; needsSync: boolean }> {
  return http(`/api/admin/one-time-links/${eventTypeId}/poll/finalize`, {
    method: 'POST',
    body: JSON.stringify({ startUtc }),
  });
}

export function removePollParticipant(eventTypeId: string, participantId: string): Promise<unknown> {
  return http(`/api/admin/one-time-links/${eventTypeId}/poll/participants/${participantId}`, {
    method: 'DELETE',
  });
}

// ─────────────────────────────────────────────────────────────
// Public — the personal token rides in a header, never the URL.
// ─────────────────────────────────────────────────────────────

const PARTICIPANT_HEADER = 'X-Poll-Participant';

function participantHeaders(participantToken: string | null): Record<string, string> {
  return participantToken ? { [PARTICIPANT_HEADER]: participantToken } : {};
}

export function getPublicPoll(
  inviteToken: string,
  tz: string,
  participantToken: string | null,
): Promise<PublicPollView> {
  const url = new URL(`/api/public/polls/${encodeURIComponent(inviteToken)}`, window.location.origin);
  url.searchParams.set('tz', tz);
  return http(url.toString(), { headers: participantHeaders(participantToken) });
}

export interface PollResponsePayload {
  name: string;
  email: string;
  timezone: string;
  votes: { startUtc: string; value: VoteValue }[];
}

export function submitPollResponse(
  inviteToken: string,
  participantToken: string | null,
  payload: PollResponsePayload,
): Promise<{ participantToken: string | null }> {
  return http(`/api/public/polls/${encodeURIComponent(inviteToken)}`, {
    method: 'POST',
    headers: participantHeaders(participantToken),
    body: JSON.stringify(payload),
  });
}
