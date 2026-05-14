'use client';

/**
 * "New one-time link" dialog.
 *
 * Two screens behind a single dialog:
 *   1. Form — title, duration, destination calendar, optional schedule,
 *              hidden guests, note, expiry.
 *   2. Result — copyable URL shown ONCE; admin must save it now because the
 *              raw token is unrecoverable (only sha256 is stored).
 *
 * Posts to POST /api/admin/event-types/one-time which creates a hidden +
 * invite-only EventType AND mints the BookingInvite in a single transaction.
 */
import { useMemo, useState } from 'react';
import { Copy, Link2, Plus } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GuestChipInput } from '@/components/ui/guest-chip-input';
import { copyToClipboard } from '@/lib/clipboard';
import { createOneTimeLink, eventTypeKeys, type OneTimeLinkResult } from '@/lib/api/event-types';
import { ApiError } from '@/lib/api/http';
import type {
  CalendarOption,
  ConnectedAccountOption,
  ScheduleOption,
} from './event-type-form';

interface OneTimeLinkDialogProps {
  accounts: ConnectedAccountOption[];
  calendars: CalendarOption[];
  schedules: ScheduleOption[];
}

const DURATION_OPTIONS = [15, 30, 45, 60, 90];

export function OneTimeLinkDialog({ accounts, calendars, schedules }: OneTimeLinkDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Link2 className="h-4 w-4" />
        New one-time link
      </Button>
      {open ? (
        <OneTimeLinkDialogBody
          accounts={accounts}
          calendars={calendars}
          schedules={schedules}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

interface BodyProps extends OneTimeLinkDialogProps {
  onClose: () => void;
}

function OneTimeLinkDialogBody({ accounts, calendars, schedules, onClose }: BodyProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '');
  // Default to the first eligible calendar on the selected account.
  const eligibleCalendars = useMemo(
    () => calendars.filter((c) => c.connectedAccountId === accountId && c.isDestinationEligible),
    [calendars, accountId],
  );
  const [calendarId, setCalendarId] = useState<string>(eligibleCalendars[0]?.id ?? '');
  const [scheduleId, setScheduleId] = useState<string>('');
  const [hiddenGuests, setHiddenGuests] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<string>(''); // '', '1', '7', '30'
  const [result, setResult] = useState<OneTimeLinkResult | null>(null);

  // Keep calendar selection in sync when the account changes.
  function handleAccountChange(next: string) {
    setAccountId(next);
    const first = calendars.find((c) => c.connectedAccountId === next && c.isDestinationEligible);
    setCalendarId(first?.id ?? '');
  }

  const mutation = useMutation({
    mutationFn: createOneTimeLink,
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: eventTypeKeys.all });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else if (err instanceof Error) {
        toast.error(err.message);
      } else {
        toast.error('Could not create one-time link.');
      }
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Title is required.');
      return;
    }
    if (!accountId || !calendarId) {
      toast.error('Pick a destination calendar.');
      return;
    }
    const expiresAt = (() => {
      if (!expiresInDays) return undefined;
      const days = Number(expiresInDays);
      if (!Number.isFinite(days) || days <= 0) return undefined;
      return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    })();
    mutation.mutate({
      title: title.trim(),
      durationMinutes,
      destinationAccountId: accountId,
      destinationCalendarId: calendarId,
      scheduleId: scheduleId || undefined,
      hiddenGuests: hiddenGuests.length ? hiddenGuests : undefined,
      note: note.trim() || undefined,
      expiresAt,
    });
  }

  async function copyUrl() {
    if (!result) return;
    try {
      await copyToClipboard(result.url);
      toast.success('Link copied to clipboard.');
    } catch {
      toast.error('Could not copy automatically — select the URL above and copy it.');
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) onClose();
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>One-time link ready</DialogTitle>
              <DialogDescription>
                Copy this URL now — for security, we can&apos;t show it again. The link is single-use; once
                it&apos;s booked, it stops working.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 rounded-lg border border-input bg-muted/40 p-3">
              <code className="break-all text-xs text-foreground">{result.url}</code>
              <Button type="button" variant="secondary" onClick={copyUrl} className="self-start">
                <Copy className="h-4 w-4" /> Copy link
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>New one-time link</DialogTitle>
              <DialogDescription>
                Creates a hidden event type plus a single-use invite. The slug is generated — the
                event type won&apos;t appear on your public profile, and the URL only works once.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Label htmlFor="ot-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ot-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                required
                placeholder="e.g. Intro with Sarah"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ot-duration">Duration</Label>
              <Select
                value={String(durationMinutes)}
                onValueChange={(v) => setDurationMinutes(Number(v))}
              >
                <SelectTrigger id="ot-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ot-account">Destination calendar</Label>
              {accounts.length === 0 ? (
                <p className="text-xs text-destructive">
                  Connect a Google account first.
                </p>
              ) : (
                <>
                  <Select value={accountId} onValueChange={handleAccountChange}>
                    <SelectTrigger id="ot-account">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.googleUserEmail}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={calendarId} onValueChange={setCalendarId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a calendar" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleCalendars.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {eligibleCalendars.length === 0 && (
                    <p className="text-xs text-destructive">
                      No destination-eligible calendars on this account.
                    </p>
                  )}
                </>
              )}
            </div>

            {schedules.length > 1 && (
              <div className="grid gap-2">
                <Label htmlFor="ot-schedule">Schedule</Label>
                <Select
                  value={scheduleId || '__default__'}
                  onValueChange={(v) => setScheduleId(v === '__default__' ? '' : v)}
                >
                  <SelectTrigger id="ot-schedule">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default schedule</SelectItem>
                    {schedules.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="ot-hidden-guests">Always invite (hidden from booker)</Label>
              <GuestChipInput
                id="ot-hidden-guests"
                value={hiddenGuests}
                onChange={setHiddenGuests}
                max={20}
                placeholder="cc@yourcompany.com"
              />
              <p className="text-xs text-muted-foreground">
                Optional. Added as attendees on the booking. The booker never sees them.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ot-note">Note</Label>
              <Input
                id="ot-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Admin-only label, e.g. Sarah at Acme"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ot-expires">Expires</Label>
              <Select value={expiresInDays || '__never__'} onValueChange={(v) => setExpiresInDays(v === '__never__' ? '' : v)}>
                <SelectTrigger id="ot-expires">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__never__">Never</SelectItem>
                  <SelectItem value="1">In 1 day</SelectItem>
                  <SelectItem value="7">In 7 days</SelectItem>
                  <SelectItem value="30">In 30 days</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Single-use either way — this just adds a deadline.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                <Plus className="h-4 w-4" />
                {mutation.isPending ? 'Creating…' : 'Create link'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
