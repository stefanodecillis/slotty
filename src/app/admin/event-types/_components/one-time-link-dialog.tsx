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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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
import {
  createOneTimeLink,
  eventTypeKeys,
  oneTimeLinkKeys,
  type OneTimeLinkPayload,
  type OneTimeLinkResult,
} from '@/lib/api/event-types';
import { ApiError } from '@/lib/api/http';
import type {
  BrandOption,
  CalendarOption,
  ConnectedAccountOption,
  ScheduleOption,
} from './event-type-form';

interface OneTimeLinkDialogProps {
  accounts: ConnectedAccountOption[];
  calendars: CalendarOption[];
  schedules: ScheduleOption[];
  brands: BrandOption[];
  /** User's default brand id (or null). Prefilled into the form. */
  defaultBrandId: string | null;
}

const DURATION_OPTIONS = [15, 30, 45, 60, 90];

const LOCATION_KIND_OPTIONS: { value: NonNullable<OneTimeLinkPayload['locationKind']>; label: string }[] = [
  { value: 'google_meet', label: 'Google Meet' },
  { value: 'phone', label: 'Phone call' },
  { value: 'in_person', label: 'In person' },
  { value: 'custom_link', label: 'Custom link' },
];

const SLOT_INTERVAL_OPTIONS = [5, 10, 15, 20, 30, 60];

// Server-side defaults (must mirror src/app/api/admin/event-types/one-time/route.ts).
const DEFAULTS = {
  bookingWindowDays: 60,
  minNoticeMin: 60,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  slotIntervalMin: 15,
  maxGuests: 3,
  sendReminders: true,
} as const;

export function OneTimeLinkDialog({
  accounts,
  calendars,
  schedules,
  brands,
  defaultBrandId,
}: OneTimeLinkDialogProps) {
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
          brands={brands}
          defaultBrandId={defaultBrandId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

interface BodyProps extends OneTimeLinkDialogProps {
  onClose: () => void;
}

function OneTimeLinkDialogBody({
  accounts,
  calendars,
  schedules,
  brands,
  defaultBrandId,
  onClose,
}: BodyProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [brandId, setBrandId] = useState<string>(defaultBrandId ?? '');
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

  // Advanced settings (all start at server defaults; only sent if the admin opens
  // the disclosure and changes something — we still always send them since the
  // server treats them as optional with the same defaults).
  const [descriptionMd, setDescriptionMd] = useState('');
  const [locationKind, setLocationKind] = useState<NonNullable<OneTimeLinkPayload['locationKind']>>(
    'google_meet',
  );
  const [locationValue, setLocationValue] = useState('');
  const [bookingWindowDays, setBookingWindowDays] = useState<number>(DEFAULTS.bookingWindowDays);
  const [minNoticeValue, setMinNoticeValue] = useState<number>(60);
  const [minNoticeUnit, setMinNoticeUnit] = useState<'minutes' | 'hours'>('minutes');
  const [bufferBeforeMin, setBufferBeforeMin] = useState<number>(DEFAULTS.bufferBeforeMin);
  const [bufferAfterMin, setBufferAfterMin] = useState<number>(DEFAULTS.bufferAfterMin);
  const [slotIntervalMin, setSlotIntervalMin] = useState<number>(DEFAULTS.slotIntervalMin);
  const [maxGuests, setMaxGuests] = useState<number>(DEFAULTS.maxGuests);
  const [confirmationMd, setConfirmationMd] = useState('');
  const [sendReminders, setSendReminders] = useState<boolean>(DEFAULTS.sendReminders);

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
      queryClient.invalidateQueries({ queryKey: oneTimeLinkKeys.all });
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
    // Translate min-notice into the canonical minutes the server expects.
    const minNoticeMin = minNoticeUnit === 'hours' ? minNoticeValue * 60 : minNoticeValue;

    // Conditional location value — only meaningful for in_person / custom_link.
    const needsLocationValue = locationKind === 'in_person' || locationKind === 'custom_link';
    if (needsLocationValue && !locationValue.trim()) {
      toast.error(
        locationKind === 'in_person'
          ? 'Address is required for in-person events.'
          : 'URL is required for custom-link events.',
      );
      return;
    }

    mutation.mutate({
      title: title.trim(),
      durationMinutes,
      destinationAccountId: accountId,
      destinationCalendarId: calendarId,
      scheduleId: scheduleId || undefined,
      hiddenGuests: hiddenGuests.length ? hiddenGuests : undefined,
      note: note.trim() || undefined,
      expiresAt,
      // Advanced — server defaults to the same numbers if these are omitted,
      // so it's safe to always forward.
      descriptionMd: descriptionMd.trim() || undefined,
      locationKind,
      locationValue: needsLocationValue ? locationValue.trim() : undefined,
      bookingWindowDays,
      minNoticeMin,
      bufferBeforeMin,
      bufferAfterMin,
      slotIntervalMin,
      maxGuests,
      confirmationMd: confirmationMd.trim() || undefined,
      sendReminders,
      brandId: brandId || null,
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
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

            {brands.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="ot-brand">Brand</Label>
                <Select
                  value={brandId || '__none__'}
                  onValueChange={(v) => setBrandId(v === '__none__' ? '' : v)}
                >
                  <SelectTrigger id="ot-brand">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No brand</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden
                            className="inline-block h-3 w-3 rounded-full border border-border"
                            style={{ backgroundColor: b.primaryColor }}
                          />
                          {b.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Shown to the invitee on the booking page (logo, colors, favicon).
                </p>
              </div>
            )}

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

            <details className="group rounded-lg border border-input bg-background">
              <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/40">
                <span>Advanced settings</span>
                <span className="text-xs text-muted-foreground group-open:hidden">Optional</span>
                <span className="hidden text-xs text-muted-foreground group-open:inline">
                  Hide
                </span>
              </summary>
              <div className="flex flex-col gap-4 border-t border-input px-3 py-3">
                {/* Description shown on the booking page */}
                <div className="grid gap-2">
                  <Label htmlFor="ot-description">Description</Label>
                  <Textarea
                    id="ot-description"
                    rows={3}
                    value={descriptionMd}
                    onChange={(e) => setDescriptionMd(e.target.value)}
                    placeholder="Markdown supported. Shown to the booker on the event page."
                  />
                </div>

                {/* Location */}
                <div className="grid gap-2">
                  <Label htmlFor="ot-location-kind">Location</Label>
                  <Select
                    value={locationKind}
                    onValueChange={(v) =>
                      setLocationKind(v as NonNullable<OneTimeLinkPayload['locationKind']>)
                    }
                  >
                    <SelectTrigger id="ot-location-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOCATION_KIND_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(locationKind === 'in_person' || locationKind === 'custom_link') && (
                    <Input
                      value={locationValue}
                      onChange={(e) => setLocationValue(e.target.value)}
                      placeholder={
                        locationKind === 'in_person'
                          ? '123 Main St, San Francisco'
                          : 'https://zoom.us/j/…'
                      }
                    />
                  )}
                </div>

                {/* Booking window — "how far ahead can the client book" */}
                <div className="grid gap-2">
                  <Label htmlFor="ot-booking-window">Booking window</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="ot-booking-window"
                      type="number"
                      min={1}
                      max={365}
                      value={String(bookingWindowDays)}
                      onChange={(e) =>
                        setBookingWindowDays(
                          Math.max(1, Math.min(365, Number(e.target.value) || 1)),
                        )
                      }
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">days into the future</span>
                  </div>
                </div>

                {/* Minimum notice */}
                <div className="grid gap-2">
                  <Label htmlFor="ot-min-notice">Minimum notice</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="ot-min-notice"
                      type="number"
                      min={0}
                      value={String(minNoticeValue)}
                      onChange={(e) =>
                        setMinNoticeValue(Math.max(0, Number(e.target.value) || 0))
                      }
                      className="w-24"
                    />
                    <Select
                      value={minNoticeUnit}
                      onValueChange={(v) => setMinNoticeUnit(v as 'minutes' | 'hours')}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minutes">minutes</SelectItem>
                        <SelectItem value="hours">hours</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">before each slot</span>
                  </div>
                </div>

                {/* Buffers */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="ot-buffer-before">Buffer before (min)</Label>
                    <Input
                      id="ot-buffer-before"
                      type="number"
                      min={0}
                      max={120}
                      value={String(bufferBeforeMin)}
                      onChange={(e) =>
                        setBufferBeforeMin(
                          Math.max(0, Math.min(120, Number(e.target.value) || 0)),
                        )
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ot-buffer-after">Buffer after (min)</Label>
                    <Input
                      id="ot-buffer-after"
                      type="number"
                      min={0}
                      max={120}
                      value={String(bufferAfterMin)}
                      onChange={(e) =>
                        setBufferAfterMin(
                          Math.max(0, Math.min(120, Number(e.target.value) || 0)),
                        )
                      }
                    />
                  </div>
                </div>

                {/* Slot interval + max guests */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="ot-slot-interval">Slot interval</Label>
                    <Select
                      value={String(slotIntervalMin)}
                      onValueChange={(v) => setSlotIntervalMin(Number(v))}
                    >
                      <SelectTrigger id="ot-slot-interval">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SLOT_INTERVAL_OPTIONS.map((m) => (
                          <SelectItem key={m} value={String(m)}>
                            {m} minutes
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ot-max-guests">Max additional guests</Label>
                    <Input
                      id="ot-max-guests"
                      type="number"
                      min={0}
                      max={20}
                      value={String(maxGuests)}
                      onChange={(e) =>
                        setMaxGuests(Math.max(0, Math.min(20, Number(e.target.value) || 0)))
                      }
                    />
                  </div>
                </div>

                {/* Confirmation message */}
                <div className="grid gap-2">
                  <Label htmlFor="ot-confirmation">Confirmation message</Label>
                  <Textarea
                    id="ot-confirmation"
                    rows={2}
                    value={confirmationMd}
                    onChange={(e) => setConfirmationMd(e.target.value)}
                    placeholder="Markdown. Shown after booking and in the confirmation email."
                  />
                </div>

                {/* Reminders */}
                <div className="flex items-center justify-between gap-3 rounded-md border border-input px-3 py-2">
                  <div className="flex flex-col">
                    <Label htmlFor="ot-send-reminders">Send reminders</Label>
                    <p className="text-xs text-muted-foreground">
                      Automatic reminder emails before the meeting.
                    </p>
                  </div>
                  <Switch
                    id="ot-send-reminders"
                    checked={sendReminders}
                    onCheckedChange={setSendReminders}
                  />
                </div>
              </div>
            </details>

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
