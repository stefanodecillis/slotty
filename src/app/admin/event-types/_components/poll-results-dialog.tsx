'use client';

/**
 * Answers for a group-poll invitation: who answered, and the best common
 * times. Booking a time creates one meeting with everyone who answered and
 * closes the poll (the invitation then shows as booked).
 */
import { useState } from 'react';
import { CalendarCheck, CalendarDays, X } from 'lucide-react';
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

interface Props {
  eventTypeId: string;
  title: string;
  onClose: () => void;
}

export function PollResultsDialog({ eventTypeId, title, onClose }: Props) {
  const queryClient = useQueryClient();
  const ownerTz = useOwnerTimezone();
  const [confirmStart, setConfirmStart] = useState<string | null>(null);

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

            <Participants
              data={data}
              removing={remove.isPending}
              onRemove={(id) => remove.mutate(id)}
            />

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
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">Answers</h3>
      <ul className="flex flex-col gap-1">
        {data.participants.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <span className="truncate text-foreground">{p.name}</span>
            <span className="truncate text-xs text-muted-foreground">{p.email}</span>
            {p.source === 'google' ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                title="Pre-filled from Google Calendar free/busy"
              >
                <CalendarDays className="h-3 w-3" aria-hidden /> Google
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
