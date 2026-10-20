'use client';

/**
 * Renders the one-time invitations list on /admin/event-types.
 *
 * Two kinds of rows:
 *   - pending — copy the link again, edit everything, or delete it.
 *   - booked  — the meeting is coming up. Nothing is editable any more; the
 *               only action is cancelling the meeting, which ends the
 *               invitation.
 * Invitations whose meeting is over (or that expired) disappear on their own.
 *
 * Group invitations (availability polls) show how many people answered and
 * open the answers dialog, where the owner books the common time.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarCheck, Copy, Link2, Pencil, Trash2, Users } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useOwnerTimezone } from '@/components/admin/owner-tz-provider';
import { copyToClipboard } from '@/lib/clipboard';
import { bookingKeys, cancelBookingAdmin } from '@/lib/api/bookings';
import {
  deleteOneTimeLink,
  listOneTimeLinks,
  oneTimeLinkKeys,
  type OneTimeLinkListItem,
} from '@/lib/api/event-types';
import {
  EditOneTimeLinkDialog,
  OneTimeLinkDialog,
  type OneTimeLinkOptions,
} from './one-time-link-dialog';
import { PollResultsDialog } from './poll-results-dialog';

interface Props {
  options: OneTimeLinkOptions;
}

type PendingAction =
  | { kind: 'delete'; link: OneTimeLinkListItem }
  | { kind: 'cancel-meeting'; link: OneTimeLinkListItem };

export function OneTimeLinksSection({ options }: Props) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [answersFor, setAnswersFor] = useState<OneTimeLinkListItem | null>(null);
  const [confirm, setConfirm] = useState<PendingAction | null>(null);

  const query = useQuery({
    queryKey: oneTimeLinkKeys.list(),
    queryFn: listOneTimeLinks,
  });

  const actionMutation = useMutation({
    mutationFn: (action: PendingAction) =>
      action.kind === 'delete'
        ? deleteOneTimeLink(action.link.eventTypeId)
        : cancelBookingAdmin(action.link.booking!.id),
    onSuccess: (_data, action) => {
      toast.success(action.kind === 'delete' ? 'Invitation deleted.' : 'Meeting cancelled.');
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: oneTimeLinkKeys.all });
      if (action.kind === 'cancel-meeting') {
        void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Something went wrong.');
      // The invitation may have been booked meanwhile — show the fresh state.
      void queryClient.invalidateQueries({ queryKey: oneTimeLinkKeys.list() });
    },
  });

  const links = query.data?.links ?? [];

  // `?answers=<eventTypeId>` (the link in the poll.ready webhook) opens that
  // poll's answers straight away.
  useEffect(() => {
    if (!query.data) return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get('answers');
    if (!id) return;
    const link = query.data.links.find((l) => l.eventTypeId === id && l.groupPoll);
    if (link) setAnswersFor(link);
    url.searchParams.delete('answers');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [query.data]);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">One-time invitations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Private, single-use booking links for one person or a whole group. Editable until
            booked; gone once the meeting is over.
          </p>
        </div>
        <OneTimeLinkDialog options={options} />
      </header>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : links.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <Link2 className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">No open invitations.</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Click <strong>New invitation</strong> above to create a link for one person, with its
            own availability if you like.
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border bg-card">
          {links.map((link, idx) => (
            <OneTimeLinkRow
              key={link.eventTypeId}
              link={link}
              isFirst={idx === 0}
              onEdit={() => setEditingId(link.eventTypeId)}
              onAnswers={() => setAnswersFor(link)}
              onDelete={() => setConfirm({ kind: 'delete', link })}
              onCancelMeeting={() => setConfirm({ kind: 'cancel-meeting', link })}
            />
          ))}
        </ul>
      )}

      {answersFor ? (
        <PollResultsDialog
          eventTypeId={answersFor.eventTypeId}
          title={answersFor.title}
          onClose={() => setAnswersFor(null)}
        />
      ) : null}

      {editingId ? (
        <EditOneTimeLinkDialog
          eventTypeId={editingId}
          options={options}
          onClose={() => setEditingId(null)}
        />
      ) : null}

      <Dialog open={confirm !== null} onOpenChange={(open) => (open ? undefined : setConfirm(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === 'cancel-meeting' ? 'Cancel meeting' : 'Delete invitation'}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === 'cancel-meeting'
                ? 'The meeting is removed from your calendar and the booker and any guests are notified by Google Calendar. The invitation ends with it.'
                : 'The link stops working immediately. This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirm(null)}
              disabled={actionMutation.isPending}
            >
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirm && actionMutation.mutate(confirm)}
              disabled={actionMutation.isPending}
            >
              {actionMutation.isPending
                ? 'Working…'
                : confirm?.kind === 'cancel-meeting'
                  ? 'Cancel meeting'
                  : 'Delete invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

interface RowProps {
  link: OneTimeLinkListItem;
  isFirst: boolean;
  onEdit: () => void;
  onAnswers: () => void;
  onDelete: () => void;
  onCancelMeeting: () => void;
}

function OneTimeLinkRow({ link, isFirst, onEdit, onAnswers, onDelete, onCancelMeeting }: RowProps) {
  const ownerTz = useOwnerTimezone();
  const expiresLabel = useMemo(() => describeExpiry(link.expiresAt), [link.expiresAt]);
  const createdLabel = useMemo(() => describeAgo(link.createdAt), [link.createdAt]);
  const booked = link.status === 'booked' && link.booking;
  const poll = link.groupPoll;

  async function copyUrl() {
    if (!link.url) return;
    try {
      await copyToClipboard(link.url);
      toast.success('Link copied to clipboard.');
    } catch {
      toast.error('Could not copy the link.');
    }
  }

  return (
    <li
      className={`flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/50 ${
        isFirst ? '' : 'border-t border-border'
      }`}
    >
      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: link.color }}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-base font-medium text-foreground">{link.title}</span>
          {booked ? (
            <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
              Booked
            </span>
          ) : poll ? (
            <>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                Group ·{' '}
                {poll.expected > 0
                  ? `${poll.expectedAnswered} of ${poll.expected} answered`
                  : `${poll.responses} answer${poll.responses === 1 ? '' : 's'}`}
              </span>
              {poll.readyAt ? (
                <span
                  className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400"
                  title="Everyone you expected has answered, or the answer-by deadline passed"
                >
                  Ready to book
                </span>
              ) : null}
            </>
          ) : (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              Awaiting booking
            </span>
          )}
        </div>
        {booked ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="text-foreground">
              {formatMeeting(link.booking!.startAt, link.booking!.endAt, ownerTz)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate">
              {poll && poll.responses > 1
                ? `${link.booking!.bookerName} and ${poll.responses - 1} other${poll.responses === 2 ? '' : 's'}`
                : `${link.booking!.bookerName} (${link.booking!.bookerEmail})`}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{link.durationMinutes} min</span>
            <span aria-hidden="true">·</span>
            <span>{link.availabilityLabel}</span>
            <span aria-hidden="true">·</span>
            <span>Created {createdLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{expiresLabel}</span>
            {link.hiddenGuestsCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  +{link.hiddenGuestsCount} hidden guest
                  {link.hiddenGuestsCount === 1 ? '' : 's'}
                </span>
              </>
            )}
          </div>
        )}
        {link.note ? (
          <div className="mt-0.5 truncate text-xs italic text-muted-foreground">{link.note}</div>
        ) : null}
        {!booked && !link.url ? (
          <div className="mt-0.5 text-xs text-muted-foreground">
            Created before links could be copied again — the original URL still works.
          </div>
        ) : null}
      </div>

      {booked ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" asChild title="View booking">
            <Link href={`/admin/bookings/${link.booking!.id}`} aria-label="View booking">
              <CalendarCheck className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancelMeeting}
            aria-label="Cancel meeting"
            title="Cancel meeting"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          {poll ? (
            <Button variant="ghost" size="sm" onClick={onAnswers} title="Answers and best times">
              <Users className="h-4 w-4" />
              Answers
            </Button>
          ) : null}
          {link.url ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={copyUrl}
              aria-label="Copy link"
              title="Copy link"
            >
              <Copy className="h-4 w-4" />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit" title="Edit">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label="Delete invitation"
            title="Delete invitation"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </li>
  );
}

function formatMeeting(startIso: string, endIso: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(new Date(startIso));
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
  return `${day}, ${time.format(new Date(startIso))}–${time.format(new Date(endIso))}`;
}

function describeExpiry(iso: string | null): string {
  if (!iso) return 'no expiry';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `expires in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours >= 1) return `expires in ${hours} hour${hours === 1 ? '' : 's'}`;
  return 'expires soon';
}

function describeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  return `${days}d ago`;
}
