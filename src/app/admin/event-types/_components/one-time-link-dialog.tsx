'use client';

/**
 * Create / edit dialog for one-time invitations.
 *
 * Create has two screens behind a single dialog:
 *   1. Form — title, duration, destination account, availability, hidden
 *              guests, note, expiry, advanced settings.
 *   2. Result — the shareable URL. It can be copied again from the list
 *              until somebody books it.
 *
 * Edit loads the invitation's current values and PATCHes the whole form.
 * The server refuses (409) once the invitation has been booked.
 *
 * Availability is either one of the owner's schedules or custom weekly hours
 * + date overrides that belong to this invitation only.
 *
 * "A group" turns the invitation into a group availability poll: everyone
 * with the link marks when they're free and the owner books the common slot.
 */
import { useMemo, useState } from 'react';
import { Copy, Link2, Plus, Users } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { cn } from '@/lib/utils/cn';
import {
  createOneTimeLink,
  getOneTimeLink,
  oneTimeLinkKeys,
  updateOneTimeLink,
  type OneTimeLinkCreated,
  type OneTimeLinkPayload,
} from '@/lib/api/event-types';
import {
  WeeklyHoursEditor,
  validateRules,
  type RuleData,
} from '../../availability/_components/weekly-grid';
import {
  OverridesCalendarView,
  type OverrideChange,
  type OverrideEntry,
} from '../../availability/_components/overrides-calendar';
import type { BrandOption, ConnectedAccountOption, ScheduleOption } from './event-type-form';

/** Everything the form needs from the server page to render its pickers. */
export interface OneTimeLinkOptions {
  accounts: ConnectedAccountOption[];
  schedules: ScheduleOption[];
  brands: BrandOption[];
  /** User's default brand id (or null). Prefilled into new invitations. */
  defaultBrandId: string | null;
  /** Starting point when switching an invitation to custom hours. */
  defaultHours: { timezone: string; rules: RuleData[] };
  /** Whether group-poll participants can import from Google on this deployment. */
  participantGoogle: { available: boolean; redirectUri: string };
}

type LocationKind = OneTimeLinkPayload['locationKind'];

const DURATION_OPTIONS = [15, 30, 45, 60, 90];

const LOCATION_KIND_OPTIONS: { value: LocationKind; label: string }[] = [
  { value: 'google_meet', label: 'Google Meet' },
  { value: 'phone', label: 'Phone call' },
  { value: 'in_person', label: 'In person' },
  { value: 'custom_link', label: 'Custom link' },
];

const SLOT_INTERVAL_OPTIONS = [5, 10, 15, 20, 30, 60];

// Must mirror MAX_POLL_WINDOW_DAYS in src/lib/group-poll/validator.ts.
const MAX_POLL_WINDOW_DAYS = 31;
const DEFAULT_POLL_WINDOW_DAYS = 14;

// Server-side defaults (must mirror src/lib/one-time/validator.ts).
const DEFAULTS = {
  bookingWindowDays: 60,
  minNoticeMin: 60,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  slotIntervalMin: 15,
  maxGuests: 3,
  sendReminders: true,
} as const;

// '__keep__' only exists when editing an invitation that already has an expiry.
type ExpiryChoice = '__keep__' | '__never__' | '1' | '7' | '30';
// Same idea for a group poll's answer-by deadline (days from now).
type AnswerByChoice = '__keep__' | '__none__' | '1' | '2' | '3' | '7';

interface FormState {
  title: string;
  durationMinutes: number;
  accountId: string;
  brandId: string;
  availabilityMode: 'schedule' | 'custom';
  scheduleId: string; // '' → default schedule
  customTimezone: string;
  customRules: RuleData[];
  customOverrides: Map<string, OverrideEntry>;
  hiddenGuests: string[];
  note: string;
  expiry: ExpiryChoice;
  descriptionMd: string;
  locationKind: LocationKind;
  locationValue: string;
  bookingWindowDays: number;
  minNoticeValue: number;
  minNoticeUnit: 'minutes' | 'hours' | 'days';
  bufferBeforeMin: number;
  bufferAfterMin: number;
  slotIntervalMin: number;
  maxGuests: number;
  confirmationMd: string;
  sendReminders: boolean;
  audience: 'one' | 'group';
  pollShowNames: boolean;
  pollAllowGoogle: boolean;
  pollExpected: string[];
  pollAnswerBy: AnswerByChoice;
  /** The saved deadline, for "Keep" when editing. */
  pollAnswerByInitial: string | null;
  pollAutoBook: boolean;
}

function emptyForm(options: OneTimeLinkOptions): FormState {
  return {
    title: '',
    durationMinutes: 30,
    accountId: options.accounts[0]?.id ?? '',
    brandId: options.defaultBrandId ?? '',
    availabilityMode: 'schedule',
    scheduleId: '',
    customTimezone: options.defaultHours.timezone,
    customRules: options.defaultHours.rules,
    customOverrides: new Map(),
    hiddenGuests: [],
    note: '',
    expiry: '__never__',
    descriptionMd: '',
    locationKind: 'google_meet',
    locationValue: '',
    bookingWindowDays: DEFAULTS.bookingWindowDays,
    minNoticeValue: DEFAULTS.minNoticeMin,
    minNoticeUnit: 'minutes',
    bufferBeforeMin: DEFAULTS.bufferBeforeMin,
    bufferAfterMin: DEFAULTS.bufferAfterMin,
    slotIntervalMin: DEFAULTS.slotIntervalMin,
    maxGuests: DEFAULTS.maxGuests,
    confirmationMd: '',
    sendReminders: DEFAULTS.sendReminders,
    audience: 'one',
    pollShowNames: true,
    pollAllowGoogle: true,
    pollExpected: [],
    pollAnswerBy: '__none__',
    pollAnswerByInitial: null,
    pollAutoBook: false,
  };
}

function formFromValues(values: OneTimeLinkPayload, options: OneTimeLinkOptions): FormState {
  const base = emptyForm(options);
  const minNotice =
    values.minNoticeMin > 0 && values.minNoticeMin % 1440 === 0
      ? { minNoticeValue: values.minNoticeMin / 1440, minNoticeUnit: 'days' as const }
      : values.minNoticeMin > 0 && values.minNoticeMin % 60 === 0
        ? { minNoticeValue: values.minNoticeMin / 60, minNoticeUnit: 'hours' as const }
        : { minNoticeValue: values.minNoticeMin, minNoticeUnit: 'minutes' as const };
  const availability = values.availability;
  return {
    ...base,
    ...minNotice,
    title: values.title,
    durationMinutes: values.durationMinutes,
    accountId: values.destinationAccountId,
    brandId: values.brandId ?? '',
    availabilityMode: availability.kind,
    scheduleId: availability.kind === 'schedule' ? (availability.scheduleId ?? '') : '',
    ...(availability.kind === 'custom'
      ? {
          customTimezone: availability.timezone,
          customRules: availability.rules,
          customOverrides: new Map(
            availability.overrides.map((o) => [
              o.date,
              {
                date: o.date,
                isBlocked: o.isBlocked,
                startMinute: o.startMinute ?? null,
                endMinute: o.endMinute ?? null,
              },
            ]),
          ),
        }
      : {}),
    hiddenGuests: values.hiddenGuests,
    note: values.note ?? '',
    expiry: values.expiresAt ? '__keep__' : '__never__',
    descriptionMd: values.descriptionMd ?? '',
    locationKind: values.locationKind,
    locationValue: values.locationValue ?? '',
    bookingWindowDays: values.bookingWindowDays,
    bufferBeforeMin: values.bufferBeforeMin,
    bufferAfterMin: values.bufferAfterMin,
    slotIntervalMin: values.slotIntervalMin,
    maxGuests: values.maxGuests,
    confirmationMd: values.confirmationMd ?? '',
    sendReminders: values.sendReminders,
    audience: values.groupPoll.enabled ? 'group' : 'one',
    pollShowNames: values.groupPoll.showNames,
    pollAllowGoogle: values.groupPoll.allowGoogle,
    pollExpected: values.groupPoll.expected,
    pollAnswerBy: values.groupPoll.answerBy ? '__keep__' : '__none__',
    pollAnswerByInitial: values.groupPoll.answerBy,
    pollAutoBook: values.groupPoll.autoBook,
  };
}

// ─────────────────────────────────────────────────────────────
// Entry points
// ─────────────────────────────────────────────────────────────

/** "New invitation" button + create dialog. */
export function OneTimeLinkDialog({ options }: { options: OneTimeLinkOptions }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Link2 className="h-4 w-4" />
        New invitation
      </Button>
      {open ? (
        <InvitationDialogShell onClose={() => setOpen(false)}>
          <CreateInvitation options={options} onClose={() => setOpen(false)} />
        </InvitationDialogShell>
      ) : null}
    </>
  );
}

/** Edit dialog for a pending invitation. Mount it only while open. */
export function EditOneTimeLinkDialog({
  eventTypeId,
  options,
  onClose,
}: {
  eventTypeId: string;
  options: OneTimeLinkOptions;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: oneTimeLinkKeys.detail(eventTypeId),
    queryFn: () => getOneTimeLink(eventTypeId),
    // Always edit the latest server state, never a stale cached form.
    staleTime: 0,
    gcTime: 0,
  });

  const message = query.isLoading ? (
    <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
  ) : query.error || !query.data ? (
    <p className="py-8 text-center text-sm text-destructive">
      {query.error instanceof Error ? query.error.message : 'Could not load invitation.'}
    </p>
  ) : query.data.status !== 'pending' ? (
    <p className="py-8 text-center text-sm text-muted-foreground">
      This invitation has been booked and can no longer be edited.
    </p>
  ) : null;

  return (
    <InvitationDialogShell onClose={onClose}>
      {message || !query.data ? (
        <>
          <DialogHeader>
            <DialogTitle>Edit invitation</DialogTitle>
            <DialogDescription className="sr-only">Loading the invitation</DialogDescription>
          </DialogHeader>
          {message}
        </>
      ) : (
        <EditInvitation
          eventTypeId={eventTypeId}
          initial={query.data.values}
          options={options}
          onClose={onClose}
        />
      )}
    </InvitationDialogShell>
  );
}

function InvitationDialogShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">{children}</DialogContent>
    </Dialog>
  );
}

function CreateInvitation({
  options,
  onClose,
}: {
  options: OneTimeLinkOptions;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<(OneTimeLinkCreated & { group: boolean }) | null>(null);

  const mutation = useMutation({
    mutationFn: async (payload: OneTimeLinkPayload) => ({
      ...(await createOneTimeLink(payload)),
      group: payload.groupPoll.enabled,
    }),
    onSuccess: (data) => {
      setResult(data);
      void queryClient.invalidateQueries({ queryKey: oneTimeLinkKeys.all });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not create invitation.');
    },
  });

  if (result) {
    return <CreatedResult url={result.url} group={result.group} onClose={onClose} />;
  }

  return (
    <InvitationForm
      mode="create"
      initial={emptyForm(options)}
      initialExpiresAt={null}
      options={options}
      pending={mutation.isPending}
      onSubmit={(payload) => mutation.mutate(payload)}
      onCancel={onClose}
    />
  );
}

function EditInvitation({
  eventTypeId,
  initial,
  options,
  onClose,
}: {
  eventTypeId: string;
  initial: OneTimeLinkPayload;
  options: OneTimeLinkOptions;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: OneTimeLinkPayload) => updateOneTimeLink(eventTypeId, payload),
    onSuccess: () => {
      toast.success('Invitation updated.');
      void queryClient.invalidateQueries({ queryKey: oneTimeLinkKeys.all });
      onClose();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not update invitation.');
      // A 409 means it was booked meanwhile — refresh the list either way.
      void queryClient.invalidateQueries({ queryKey: oneTimeLinkKeys.list() });
    },
  });

  return (
    <InvitationForm
      mode="edit"
      initial={formFromValues(initial, options)}
      initialExpiresAt={initial.expiresAt}
      options={options}
      pending={mutation.isPending}
      onSubmit={(payload) => mutation.mutate(payload)}
      onCancel={onClose}
    />
  );
}

function CreatedResult({
  url,
  group,
  onClose,
}: {
  url: string;
  group: boolean;
  onClose: () => void;
}) {
  async function copyUrl() {
    try {
      await copyToClipboard(url);
      toast.success('Link copied to clipboard.');
    } catch {
      toast.error('Could not copy automatically — select the URL above and copy it.');
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Invitation ready</DialogTitle>
        <DialogDescription>
          {group
            ? 'Share this link with everyone in the group. Each person marks when they can make it; follow the answers from the list and pick the time when you’re ready.'
            : 'Share this link with the person you’re inviting. Until they book, you can edit the invitation and copy the link again from the list.'}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2 rounded-lg border border-input bg-muted/40 p-3">
        <code className="break-all text-xs text-foreground">{url}</code>
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
  );
}

// ─────────────────────────────────────────────────────────────
// Form
// ─────────────────────────────────────────────────────────────

interface InvitationFormProps {
  mode: 'create' | 'edit';
  initial: FormState;
  /** Expiry stored on the invitation being edited (for the "keep" option). */
  initialExpiresAt: string | null;
  options: OneTimeLinkOptions;
  pending: boolean;
  onSubmit: (payload: OneTimeLinkPayload) => void;
  onCancel: () => void;
}

function InvitationForm({
  mode,
  initial,
  initialExpiresAt,
  options,
  pending,
  onSubmit,
  onCancel,
}: InvitationFormProps) {
  const { accounts, schedules, brands } = options;
  const [form, setForm] = useState<FormState>(initial);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Keep the currently-stored duration selectable even if it's not a preset.
  const durationOptions = useMemo(
    () =>
      DURATION_OPTIONS.includes(initial.durationMinutes)
        ? DURATION_OPTIONS
        : [...DURATION_OPTIONS, initial.durationMinutes].sort((a, b) => a - b),
    [initial.durationMinutes],
  );

  const timezones = useMemo(() => {
    const list =
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? ['UTC'];
    return list.includes(form.customTimezone) ? list : [form.customTimezone, ...list];
  }, [form.customTimezone]);

  async function saveOverride(date: string, data: OverrideChange) {
    setForm((prev) => {
      const next = new Map(prev.customOverrides);
      next.set(date, {
        date,
        isBlocked: data.isBlocked,
        startMinute: data.startMinute ?? null,
        endMinute: data.endMinute ?? null,
      });
      return { ...prev, customOverrides: next };
    });
  }

  async function removeOverride(date: string) {
    setForm((prev) => {
      const next = new Map(prev.customOverrides);
      next.delete(date);
      return { ...prev, customOverrides: next };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Title is required.');
      return;
    }
    if (!form.accountId) {
      toast.error('Pick a Google account.');
      return;
    }
    const needsLocationValue = form.locationKind === 'in_person' || form.locationKind === 'custom_link';
    if (needsLocationValue && !form.locationValue.trim()) {
      toast.error(
        form.locationKind === 'in_person'
          ? 'Address is required for in-person events.'
          : 'URL is required for custom-link events.',
      );
      return;
    }
    if (form.audience === 'group' && form.bookingWindowDays > MAX_POLL_WINDOW_DAYS) {
      toast.error(`Group polls cover at most ${MAX_POLL_WINDOW_DAYS} days — shorten the booking window.`);
      return;
    }
    if (form.availabilityMode === 'custom') {
      const error = validateRules(form.customRules);
      if (error) {
        toast.error(error);
        return;
      }
    }

    const expiresAt = (() => {
      if (form.expiry === '__keep__') return initialExpiresAt;
      if (form.expiry === '__never__') return null;
      return new Date(Date.now() + Number(form.expiry) * 24 * 60 * 60 * 1000).toISOString();
    })();
    // Translate min-notice into the canonical minutes the server expects.
    const minNoticeMin =
      form.minNoticeUnit === 'days'
        ? form.minNoticeValue * 1440
        : form.minNoticeUnit === 'hours'
          ? form.minNoticeValue * 60
          : form.minNoticeValue;

    onSubmit({
      title: form.title.trim(),
      durationMinutes: form.durationMinutes,
      destinationAccountId: form.accountId,
      availability:
        form.availabilityMode === 'custom'
          ? {
              kind: 'custom',
              timezone: form.customTimezone,
              rules: form.customRules,
              overrides: Array.from(form.customOverrides.values()).map((o) => ({
                date: o.date,
                isBlocked: o.isBlocked,
                ...(o.isBlocked
                  ? {}
                  : { startMinute: o.startMinute ?? 0, endMinute: o.endMinute ?? 0 }),
              })),
            }
          : { kind: 'schedule', scheduleId: form.scheduleId || null },
      hiddenGuests: form.hiddenGuests,
      note: form.note.trim() || null,
      expiresAt,
      descriptionMd: form.descriptionMd.trim() || null,
      locationKind: form.locationKind,
      locationValue: needsLocationValue ? form.locationValue.trim() : null,
      bookingWindowDays: form.bookingWindowDays,
      minNoticeMin,
      bufferBeforeMin: form.bufferBeforeMin,
      bufferAfterMin: form.bufferAfterMin,
      slotIntervalMin: form.slotIntervalMin,
      maxGuests: form.maxGuests,
      confirmationMd: form.confirmationMd.trim() || null,
      sendReminders: form.sendReminders,
      brandId: form.brandId || null,
      groupPoll: {
        enabled: form.audience === 'group',
        showNames: form.pollShowNames,
        allowGoogle: form.pollAllowGoogle,
        expected: form.pollExpected,
        answerBy:
          form.pollAnswerBy === '__keep__'
            ? form.pollAnswerByInitial
            : form.pollAnswerBy === '__none__'
              ? null
              : new Date(Date.now() + Number(form.pollAnswerBy) * 24 * 60 * 60 * 1000).toISOString(),
        autoBook: form.pollAutoBook,
      },
    });
  }

  function setAudience(audience: FormState['audience']) {
    setForm((prev) => ({
      ...prev,
      audience,
      // A poll grid over two months is unusable; start groups on two weeks.
      bookingWindowDays:
        audience === 'group' && prev.bookingWindowDays > MAX_POLL_WINDOW_DAYS
          ? DEFAULT_POLL_WINDOW_DAYS
          : prev.bookingWindowDays,
    }));
  }

  const overrideCount = form.customOverrides.size;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{mode === 'create' ? 'New invitation' : 'Edit invitation'}</DialogTitle>
        <DialogDescription>
          {form.audience === 'group'
            ? 'A private link for a group. Everyone marks when they can make it, then you book the time that works best for all of them.'
            : 'A private booking link for one person. It isn’t listed on your public page, and it stops working once they book.'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <Label>Who&apos;s invited</Label>
        <div className="flex gap-2">
          {(
            [
              ['one', 'One person'],
              ['group', 'A group'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setAudience(value)}
              aria-pressed={form.audience === value}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                form.audience === value
                  ? 'border-primary bg-primary/[0.08] text-primary'
                  : 'border-input text-foreground hover:bg-muted/50',
              )}
            >
              {value === 'group' ? <Users className="h-4 w-4" aria-hidden /> : null}
              {label}
            </button>
          ))}
        </div>
        {form.audience === 'group' ? (
          <div className="flex flex-col gap-3 rounded-lg border border-input p-3">
            <p className="text-xs text-muted-foreground">
              Everyone with the link marks when they&apos;re free within your availability over the
              next {form.bookingWindowDays} days (change it under Advanced settings). You pick
              the final time; everyone who answered is invited to the meeting. Up to 15 people.
            </p>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <Label htmlFor="ot-poll-names">Show names to participants</Label>
                <p className="text-xs text-muted-foreground">
                  Otherwise they only see how many people can make each time.
                </p>
              </div>
              <Switch
                id="ot-poll-names"
                checked={form.pollShowNames}
                onCheckedChange={(v) => set('pollShowNames', v)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <Label htmlFor="ot-poll-google">Allow importing from Google Calendar</Label>
                <p className="text-xs text-muted-foreground">
                  {options.participantGoogle.available ? (
                    'Participants can pre-fill their answer from their free/busy. Only busy blocks are read, once, and nothing is stored.'
                  ) : (
                    <>
                      Unavailable on this server: your public URL must be HTTPS on a real domain
                      so Google can send participants back to it.
                    </>
                  )}
                </p>
                {options.participantGoogle.available ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Needs this redirect URI in your Google OAuth client:{' '}
                    <code className="break-all text-foreground">
                      {options.participantGoogle.redirectUri}
                    </code>
                  </p>
                ) : null}
              </div>
              <Switch
                id="ot-poll-google"
                checked={form.pollAllowGoogle && options.participantGoogle.available}
                disabled={!options.participantGoogle.available}
                onCheckedChange={(v) => set('pollAllowGoogle', v)}
              />
            </div>
            <div className="grid gap-2 border-t border-input pt-3">
              <Label htmlFor="ot-poll-expected">Who should answer (optional)</Label>
              <GuestChipInput
                value={form.pollExpected}
                onChange={(v) => set('pollExpected', v)}
                max={15}
              />
              <p className="text-xs text-muted-foreground">
                Their emails. Slotty tells you once all of them have answered, and shows who
                you&apos;re still waiting for.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ot-poll-answer-by">Answer by</Label>
              <Select
                value={form.pollAnswerBy}
                onValueChange={(v) => set('pollAnswerBy', v as AnswerByChoice)}
              >
                <SelectTrigger id="ot-poll-answer-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {form.pollAnswerByInitial ? (
                    <SelectItem value="__keep__">
                      Keep ({new Date(form.pollAnswerByInitial).toLocaleString()})
                    </SelectItem>
                  ) : null}
                  <SelectItem value="__none__">No deadline</SelectItem>
                  <SelectItem value="1">In 1 day</SelectItem>
                  <SelectItem value="2">In 2 days</SelectItem>
                  <SelectItem value="3">In 3 days</SelectItem>
                  <SelectItem value="7">In 7 days</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Once it passes, Slotty tells you the best times so far, even if not everyone answered.
              </p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <Label htmlFor="ot-poll-autobook">Book automatically</Label>
                <p className="text-xs text-muted-foreground">
                  When the poll is ready and a time works for everyone who answered, book the best
                  one and invite everyone. Otherwise you pick, as usual.
                </p>
              </div>
              <Switch
                id="ot-poll-autobook"
                checked={form.pollAutoBook}
                onCheckedChange={(v) => set('pollAutoBook', v)}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ot-title">
          Title <span className="text-destructive">*</span>
        </Label>
        <Input
          id="ot-title"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          autoFocus
          required
          placeholder="e.g. Intro with Sarah"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ot-duration">Duration</Label>
        <Select
          value={String(form.durationMinutes)}
          onValueChange={(v) => set('durationMinutes', Number(v))}
        >
          <SelectTrigger id="ot-duration">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {durationOptions.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {d} minutes
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ot-account">Google account</Label>
        {accounts.length === 0 ? (
          <p className="text-xs text-destructive">Connect a Google account first.</p>
        ) : (
          <>
            <Select value={form.accountId} onValueChange={(v) => set('accountId', v)}>
              <SelectTrigger id="ot-account">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.googleUserEmail}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The meeting is added to this account&apos;s primary calendar.
            </p>
          </>
        )}
      </div>

      {brands.length > 0 && (
        <div className="grid gap-2">
          <Label htmlFor="ot-brand">Brand</Label>
          <Select
            value={form.brandId || '__none__'}
            onValueChange={(v) => set('brandId', v === '__none__' ? '' : v)}
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

      {/* Availability — a shared schedule or hours just for this invitation */}
      <div className="grid gap-3">
        <Label>Availability</Label>
        <div className="flex gap-2">
          {(
            [
              ['schedule', 'Use a schedule'],
              ['custom', 'Custom hours'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => set('availabilityMode', value)}
              aria-pressed={form.availabilityMode === value}
              className={cn(
                'flex-1 rounded-md border px-3 py-2 text-sm transition-colors',
                form.availabilityMode === value
                  ? 'border-primary bg-primary/[0.08] text-primary'
                  : 'border-input text-foreground hover:bg-muted/50',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {form.availabilityMode === 'schedule' ? (
          schedules.length > 1 ? (
            <Select
              value={form.scheduleId || '__default__'}
              onValueChange={(v) => set('scheduleId', v === '__default__' ? '' : v)}
            >
              <SelectTrigger aria-label="Schedule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Default schedule</SelectItem>
                {schedules
                  .filter((s) => !s.isDefault)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground">
              Follows your regular availability. Choose <strong>Custom hours</strong> to offer
              different times to this person.
            </p>
          )
        ) : (
          <div className="flex flex-col gap-4 rounded-lg border border-input p-3">
            <p className="text-xs text-muted-foreground">
              These hours apply to this invitation only. Your calendar&apos;s busy times are still
              respected.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="ot-timezone">Timezone</Label>
              <Select value={form.customTimezone} onValueChange={(v) => set('customTimezone', v)}>
                <SelectTrigger id="ot-timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Weekly hours</Label>
              <WeeklyHoursEditor
                rules={form.customRules}
                onChange={(rules) => set('customRules', rules)}
              />
            </div>
            <details className="group rounded-md border border-input">
              <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/40">
                <span>
                  Date overrides
                  {overrideCount > 0 ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {overrideCount} date{overrideCount === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground group-open:hidden">Optional</span>
                <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
              </summary>
              <div className="border-t border-input px-3 py-3">
                <p className="mb-3 text-xs text-muted-foreground">
                  Block specific dates or set different hours on a given day.
                </p>
                <OverridesCalendarView
                  overrides={form.customOverrides}
                  timezone={form.customTimezone}
                  onSave={saveOverride}
                  onRemove={removeOverride}
                />
              </div>
            </details>
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ot-hidden-guests">Always invite (hidden from booker)</Label>
        <GuestChipInput
          id="ot-hidden-guests"
          value={form.hiddenGuests}
          onChange={(v) => set('hiddenGuests', v)}
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
          value={form.note}
          onChange={(e) => set('note', e.target.value)}
          placeholder="Admin-only label, e.g. Sarah at Acme"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ot-expires">Expires</Label>
        <Select value={form.expiry} onValueChange={(v) => set('expiry', v as ExpiryChoice)}>
          <SelectTrigger id="ot-expires">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {initialExpiresAt ? (
              <SelectItem value="__keep__">
                Keep ({new Date(initialExpiresAt).toLocaleDateString()})
              </SelectItem>
            ) : null}
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
          <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-input px-3 py-3">
          {/* Description shown on the booking page */}
          <div className="grid gap-2">
            <Label htmlFor="ot-description">Description</Label>
            <Textarea
              id="ot-description"
              rows={3}
              value={form.descriptionMd}
              onChange={(e) => set('descriptionMd', e.target.value)}
              placeholder="Markdown supported. Shown to the booker on the event page."
            />
          </div>

          {/* Location */}
          <div className="grid gap-2">
            <Label htmlFor="ot-location-kind">Location</Label>
            <Select
              value={form.locationKind}
              onValueChange={(v) => set('locationKind', v as LocationKind)}
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
            {(form.locationKind === 'in_person' || form.locationKind === 'custom_link') && (
              <Input
                value={form.locationValue}
                onChange={(e) => set('locationValue', e.target.value)}
                placeholder={
                  form.locationKind === 'in_person'
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
                max={form.audience === 'group' ? MAX_POLL_WINDOW_DAYS : 365}
                value={String(form.bookingWindowDays)}
                onChange={(e) =>
                  set(
                    'bookingWindowDays',
                    Math.max(
                      1,
                      Math.min(
                        form.audience === 'group' ? MAX_POLL_WINDOW_DAYS : 365,
                        Number(e.target.value) || 1,
                      ),
                    ),
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
                value={String(form.minNoticeValue)}
                onChange={(e) => set('minNoticeValue', Math.max(0, Number(e.target.value) || 0))}
                className="w-24"
              />
              <Select
                value={form.minNoticeUnit}
                onValueChange={(v) => set('minNoticeUnit', v as FormState['minNoticeUnit'])}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">minutes</SelectItem>
                  <SelectItem value="hours">hours</SelectItem>
                  <SelectItem value="days">days</SelectItem>
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
                value={String(form.bufferBeforeMin)}
                onChange={(e) =>
                  set('bufferBeforeMin', Math.max(0, Math.min(120, Number(e.target.value) || 0)))
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
                value={String(form.bufferAfterMin)}
                onChange={(e) =>
                  set('bufferAfterMin', Math.max(0, Math.min(120, Number(e.target.value) || 0)))
                }
              />
            </div>
          </div>

          {/* Slot interval + max guests */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="ot-slot-interval">Slot interval</Label>
              <Select
                value={String(form.slotIntervalMin)}
                onValueChange={(v) => set('slotIntervalMin', Number(v))}
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
            <div className={cn('grid gap-2', form.audience === 'group' && 'hidden')}>
              <Label htmlFor="ot-max-guests">Max additional guests</Label>
              <Input
                id="ot-max-guests"
                type="number"
                min={0}
                max={20}
                value={String(form.maxGuests)}
                onChange={(e) =>
                  set('maxGuests', Math.max(0, Math.min(20, Number(e.target.value) || 0)))
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
              value={form.confirmationMd}
              onChange={(e) => set('confirmationMd', e.target.value)}
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
              checked={form.sendReminders}
              onCheckedChange={(v) => set('sendReminders', v)}
            />
          </div>
        </div>
      </details>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {mode === 'create' ? <Plus className="h-4 w-4" /> : null}
          {pending
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving…'
            : mode === 'create'
              ? 'Create invitation'
              : 'Save changes'}
        </Button>
      </DialogFooter>
    </form>
  );
}
