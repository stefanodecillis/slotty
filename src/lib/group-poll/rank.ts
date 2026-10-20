/**
 * Pure aggregation for group polls — no DB, no Google. Given the candidate
 * slots and every participant's votes, work out who can make each slot and
 * order the slots from "best common time" downwards.
 */
import type { BusyInterval } from '@/lib/google/participant-oauth';

export type VoteValue = 'yes' | 'maybe';

export interface CandidateSlot {
  startUtc: string;
  endUtc: string;
}

export interface ParticipantVotes {
  id: string;
  /** startUtc → vote. Absent means "can't make it". */
  votes: ReadonlyMap<string, VoteValue>;
}

export interface SlotTally {
  startUtc: string;
  endUtc: string;
  yes: string[];
  maybe: string[];
  no: string[];
}

export function tallySlots(
  candidates: readonly CandidateSlot[],
  participants: readonly ParticipantVotes[],
): SlotTally[] {
  return candidates.map((c) => {
    const tally: SlotTally = { startUtc: c.startUtc, endUtc: c.endUtc, yes: [], maybe: [], no: [] };
    for (const p of participants) {
      const v = p.votes.get(c.startUtc);
      if (v === 'yes') tally.yes.push(p.id);
      else if (v === 'maybe') tally.maybe.push(p.id);
      else tally.no.push(p.id);
    }
    return tally;
  });
}

/**
 * Best first: fewest people who can't make it, then most clear "yes"es,
 * then earliest. Slots nobody can make are dropped.
 */
export function rankSlots(tallies: readonly SlotTally[]): SlotTally[] {
  return tallies
    .filter((t) => t.yes.length + t.maybe.length > 0)
    .slice()
    .sort(
      (a, b) =>
        a.no.length - b.no.length ||
        b.yes.length - a.yes.length ||
        a.startUtc.localeCompare(b.startUtc),
    );
}

/** A stretch of time someone is free, as reported by them or their assistant. */
export interface FreeRange {
  start: Date;
  end: Date;
  value: VoteValue;
}

/**
 * Votes for the candidates that fit entirely inside a free range. Candidates
 * no range covers get no vote ("can't make it"). When ranges overlap, "yes"
 * beats "maybe".
 */
export function votesFromRanges(
  candidates: readonly CandidateSlot[],
  ranges: readonly FreeRange[],
): { startUtc: string; value: VoteValue }[] {
  const votes: { startUtc: string; value: VoteValue }[] = [];
  for (const c of candidates) {
    const s = Date.parse(c.startUtc);
    const e = Date.parse(c.endUtc);
    let value: VoteValue | null = null;
    for (const r of ranges) {
      if (r.start.getTime() > s || r.end.getTime() < e) continue;
      value = r.value;
      if (value === 'yes') break;
    }
    if (value) votes.push({ startUtc: c.startUtc, value });
  }
  return votes;
}

/** Candidate slots that don't overlap any busy block — the Google pre-fill. */
export function freeSlotsFromBusy(
  candidates: readonly CandidateSlot[],
  busy: readonly BusyInterval[],
): string[] {
  const blocks = busy
    .map((b) => [b.start.getTime(), b.end.getTime()] as const)
    .sort((a, b) => a[0] - b[0]);
  const free: string[] = [];
  for (const c of candidates) {
    const s = Date.parse(c.startUtc);
    const e = Date.parse(c.endUtc);
    const overlaps = blocks.some(([bs, be]) => bs < e && be > s);
    if (!overlaps) free.push(c.startUtc);
  }
  return free;
}
