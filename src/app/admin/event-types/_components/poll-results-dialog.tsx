'use client';

/**
 * Answers for a group-poll invitation: who answered, and the best common
 * times. Booking a time creates one meeting with everyone who answered and
 * closes the poll (the invitation then shows as booked).
 */
import { useState } from 'react';
import { Bot, CalendarCheck, CalendarDays, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useOwnerTimezone } from '@/components/admin/owner-tz-provider';
import { bookingKeys } from '@/lib/api/bookings';
import { oneTimeLinkKeys } from '@/lib/api/event-types';
import {
  finalizePoll,
  getPollResults,
  pollKeys,
  removePollParticipant,
  type AdminPollResults,
} from '@/lib/api/group-poll';
import { cn } from '@/lib/utils/cn';

import { PollHeatmap } from './poll-heatmap';

interface Props {
  eventTypeId: string;
  title: string;
  onClose: () => void;
}

export function PollResultsDialog({ eventTypeId, title, onClose }: Props) {
  const queryClient = useQueryClient();
  const ownerTz = useOwnerTimezone();
  const [confirmStart, setConfirmStart] = useState<string | null>(null);
  const [gridPick, setGridPick] = useState<AdminPollResults['slots'][number] | null>(null);

  const query = useQuery({
    queryKey: pollKeys.results(eventTypeId),
    queryFn: () => getPollResults(eventTypeId),
    staleTime: 0,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: pollKeys.results(eventTypeId) });
    void queryClient.invalidateQueries({ queryKey: oneTimeLinkKeys.all });
  };

  const finalize = useMutation({
    mutationFn: (startUtc: string) => finalizePoll(eventTypeId, startUtc),
    onSuccess: (res) => {
      if (res.needsSync) {
        // Same graceful degradation as a regular booking: saved locally,
        // Google insert retried later — invitations go out once it lands.
        toast.warning('Meeting booked, but adding it to Google Calendar failed. Invitations go out once it syncs.');
      } else {
        toast.success('Meeting booked. Everyone gets a Google Calendar invitation.');
      }
      refresh();
      void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
      onClose();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not book this time.');
      setConfirmStart(null);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (participantId: string) => removePollParticipant(eventTypeId, participantId),
    onSuccess: () => {
      toast.success('Answer removed.');
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not remove.'),
  });

  const data = query.data;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {data
              ? data.participants.length === 0
                ? 'Nobody has answered yet. Share the link with the group.'
                : `${data.participants.length} ${data.participants.length === 1 ? 'person has' : 'people have'} answered.`
              : 'Group availability'}
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : query.error || !data ? (
          <p className="py-8 text-center text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : 'Could not load answers.'}
          </p>
        ) : data.status === 'finalized' ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            A time has already been booked for this group.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {data.allowGoogle && !data.google.available ? (
              <p className="rounded-md border border-input bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Google Calendar import is switched on but unavailable: participants need an HTTPS
                public URL on a real domain to come back to after Google sign-in. They can still
                answer by hand.
              </p>
            ) : null}

            <PollStatus data={data} timeZone={ownerTz} />

            <Participants
              data={data}
              removing={remove.isPending}
              onRemove={(id) => remove.mutate(id)}
            />

            {data.participants.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-foreground">Calendar</h3>
                <PollHeatmap
                  data={data}
                  timeZone={ownerTz}
                  selected={gridPick?.startUtc ?? null}
                  onPick={(slot) => setGridPick(slot)}
                />
                {gridPick ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium text-foreground">
                        {formatSlot(gridPick.startUtc, gridPick.endUtc, ownerTz)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {gridPick.no.length === 0
                          ? 'Everyone can make it.'
                          : `${gridPick.yes.length + gridPick.maybe.length} of ${data.participants.length} can make it.`}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setGridPick(null)}
                        disabled={finalize.isPending}
                      >
                        Back
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => finalize.mutate(gridPick.startUtc)}
                        disabled={finalize.isPending}
                      >
                        <CalendarCheck className="h-4 w-4" />
                        {finalize.isPending ? 'Booking…' : 'Confirm & invite all'}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">Best times</h3>
              {data.participants.length === 0 ? null : data.ranked.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No time works for anyone yet
                  {data.candidateCount === 0 ? ' — and you have no free slots in the window.' : '.'}
                </p>
              ) : (
                <ul className="overflow-hidden rounded-lg border border-border">
                  {data.ranked.map((slot, idx) => {
                    const total = data.participants.length;
                    const canMake = slot.yes.length + slot.maybe.length;
                    const everyone = slot.no.length === 0;
                    const confirming = confirmStart === slot.startUtc;
                    return (
                      <li
                        key={slot.startUtc}
                        className={cn(
                          'flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center',
                          idx > 0 && 'border-t border-border',
                        )}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {formatSlot(slot.startUtc, slot.endUtc, ownerTz)}
                            </span>
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-xs',
                                everyone
                                  ? 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {everyone ? 'Everyone' : `${canMake}/${total}`}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1 text-xs">
                            {slot.yes.map((id) => (
                              <NameChip key={id} name={nameOf(data, id)} tone="yes" />
                            ))}
                            {slot.maybe.map((id) => (
                              <NameChip key={id} name={nameOf(data, id)} tone="maybe" />
                            ))}
                            {slot.no.map((id) => (
                              <NameChip key={id} name={nameOf(data, id)} tone="no" />
                            ))}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {confirming ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmStart(null)}
                                disabled={finalize.isPending}
                              >
                                Back
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => finalize.mutate(slot.startUtc)}
                                disabled={finalize.isPending}
                              >
                                <CalendarCheck className="h-4 w-4" />
                                {finalize.isPending ? 'Booking…' : 'Confirm & invite all'}
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmStart(slot.startUtc)}
                              disabled={finalize.isPending}
                            >
                              Book this time
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                <span className="text-emerald-700 dark:text-emerald-400">Green</span> can make it,{' '}
                <span className="text-amber-700 dark:text-amber-400">amber</span> if needed,{' '}
                <span className="line-through">struck through</span> can&apos;t. Booking invites
                everyone who answered.
              </p>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Who the owner is still waiting for, the deadline, and whether the poll is ready. */
function PollStatus({ data, timeZone }: { data: AdminPollResults; timeZone: string }) {
  const waiting = data.expected.filter((e) => !e.answered);
  const deadline = data.answerBy
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
        new Date(data.answerBy),
      )
    : null;
  if (!data.readyAt && data.expected.length === 0 && !deadline && !data.autoBook) return null;

  return (
    <section
      className={cn(
        'flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs',
        data.readyAt ? 'border-emerald-600/30 bg-emerald-600/5' : 'border-input bg-muted/40',
      )}
    >
      {data.readyAt ? (
        <p className="font-medium text-emerald-700 dark:text-emerald-400">
          Ready to book —{' '}
          {data.readyReason === 'deadline'
            ? 'the answer-by deadline has passed.'
            : 'everyone you expected has answered.'}
        </p>
      ) : null}
      {data.expected.length > 0 ? (
        <p className="text-muted-foreground">
          {waiting.length === 0
            ? `All ${data.expected.length} expected people have answered.`
            : `Waiting for ${waiting.map((e) => e.email).join(', ')} (${data.expected.length - waiting.length} of ${data.expected.length} answered).`}
        </p>
      ) : null}
      {deadline ? <p className="text-muted-foreground">Answer by {deadline}.</p> : null}
      {data.autoBook ? (
        <p className="text-muted-foreground">
          {data.readyAt
            ? 'Book automatically was on, but no time worked for everyone who answered — pick one below.'
            : 'When it’s ready, Slotty books the best time if it works for everyone who answered.'}
        </p>
      ) : null}
    </section>
  );
}

function Participants({
  data,
  removing,
  onRemove,
}: {
  data: AdminPollResults;
  removing: boolean;
  onRemove: (id: string) => void;
}) {
  if (data.participants.length === 0) return null;
  // Emails aren't unique per poll (see submitPollResponse), so point out repeats.
  const emailCounts = new Map<string, number>();
  for (const p of data.participants) emailCounts.set(p.email, (emailCounts.get(p.email) ?? 0) + 1);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">Answers</h3>
      <ul className="flex flex-col gap-1">
        {data.participants.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <span className="truncate text-foreground">{p.name}</span>
            <span className="truncate text-xs text-muted-foreground">{p.email}</span>
            {p.marked === 0 ? (
              <span
                className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400"
                title="This answer doesn't mark any of the current times (they may have saved before choosing, or the times they picked are gone). Ask them to open their link again."
              >
                No times marked
              </span>
            ) : (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {p.marked} time{p.marked === 1 ? '' : 's'}
              </span>
            )}
            {(emailCounts.get(p.email) ?? 0) > 1 ? (
              <span
                className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400"
                title="Another answer uses the same email. Remove the one that's out of date."
              >
                Same email
              </span>
            ) : null}
            {p.source === 'google' ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                title="Pre-filled from Google Calendar free/busy"
              >
                <CalendarDays className="h-3 w-3" aria-hidden /> Google
              </span>
            ) : p.source === 'agent' ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                title="Answered by the participant's AI assistant"
              >
                <Bot className="h-3 w-3" aria-hidden /> Assistant
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(p.id)}
              disabled={removing}
              aria-label={`Remove ${p.name}'s answer`}
              title="Remove answer"
            >
              <X className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NameChip({ name, tone }: { name: string; tone: 'yes' | 'maybe' | 'no' }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5',
        tone === 'yes' && 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
        tone === 'maybe' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
        tone === 'no' && 'bg-muted text-muted-foreground line-through',
      )}
      title={tone === 'yes' ? 'Can make it' : tone === 'maybe' ? 'If needed' : "Can't make it"}
    >
      {name}
    </span>
  );
}

function nameOf(data: AdminPollResults, id: string): string {
  return data.participants.find((p) => p.id === id)?.name ?? 'Someone';
}

function formatSlot(startIso: string, endIso: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(new Date(startIso));
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone });
  return `${day}, ${time.format(new Date(startIso))}–${time.format(new Date(endIso))}`;
}
