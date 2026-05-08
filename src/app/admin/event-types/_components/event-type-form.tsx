'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Pencil, Calendar, Plus, ChevronDown } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QUESTION_KINDS } from '@/lib/eventtype/validator';
import type { LocationKind, QuestionKind } from '@/lib/eventtype/validator';
import {
  createEventType,
  eventTypeKeys,
  updateEventType,
  type EventTypeUpsertPayload,
} from '@/lib/api/event-types';
import { ApiError } from '@/lib/api/http';

// ─────────────────────────────────────────────────────────────
// Types (preserved from previous API)
// ─────────────────────────────────────────────────────────────

export interface ConnectedAccountOption {
  id: string;
  googleUserEmail: string;
}

export interface CalendarOption {
  id: string;
  connectedAccountId: string;
  name: string;
  isDestinationEligible: boolean;
}

export interface ScheduleOption {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface QuestionFormValue {
  id?: string;
  label: string;
  helperText: string;
  kind: QuestionKind;
  required: boolean;
  optionsJson: string;
  position: number;
}

export interface EventTypeFormValues {
  title: string;
  slug: string;
  descriptionMd: string;
  color: string;
  hidden: boolean;
  durationMinutes: number | '';
  locationKind: LocationKind;
  locationValue: string;
  destinationAccountId: string;
  destinationCalendarId: string;
  bufferBeforeMin: number | '';
  bufferAfterMin: number | '';
  minNoticeMin: number | '';
  bookingWindowDays: number | '';
  maxPerDay: number | '';
  maxPerWeek: number | '';
  maxGuests: number | '';
  slotIntervalMin: number | '';
  scheduleId: string;
  confirmationMd: string;
  redirectUrl: string;
  password: string;
  sendReminders: boolean;
  questions: QuestionFormValue[];
}

interface EventTypeFormProps {
  mode: 'create' | 'edit';
  eventTypeId?: string;
  /** The current user's username — used to render the booking URL preview. */
  username: string;
  initialValues?: Partial<EventTypeFormValues>;
  accounts: ConnectedAccountOption[];
  allCalendars: CalendarOption[];
  schedules: ScheduleOption[];
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const COLOR_SWATCHES = [
  { hex: '#4F6CFF', name: 'Indigo' },
  { hex: '#0F766E', name: 'Teal' },
  { hex: '#A16207', name: 'Amber' },
  { hex: '#B91C1C', name: 'Crimson' },
  { hex: '#7C3AED', name: 'Violet' },
  { hex: '#0E7490', name: 'Cyan' },
  { hex: '#9333EA', name: 'Purple' },
  { hex: '#475569', name: 'Slate' },
];

const DURATION_PRESETS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '60 minutes' },
  { value: '90', label: '90 minutes' },
  { value: 'custom', label: 'Custom…' },
];

const LOCATION_KIND_OPTIONS: { value: LocationKind; label: string }[] = [
  { value: 'google_meet', label: 'Google Meet' },
  { value: 'phone', label: 'Phone call' },
  { value: 'in_person', label: 'In person' },
  { value: 'custom_link', label: 'Custom link' },
];

const SLOT_INTERVAL_OPTIONS = [
  { value: '5', label: '5 minutes' },
  { value: '10', label: '10 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '20', label: '20 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '60 minutes' },
];

const MIN_NOTICE_UNITS = [
  { value: 'minutes', label: 'minutes' },
  { value: 'hours', label: 'hours' },
];

const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  text: 'Short text',
  textarea: 'Long text',
  select: 'Dropdown',
  checkbox: 'Checkbox',
  radio: 'Radio',
};

const QUESTION_KIND_OPTIONS = QUESTION_KINDS.map((k) => ({
  value: k,
  label: QUESTION_KIND_LABELS[k],
}));

const DEFAULT_VALUES: EventTypeFormValues = {
  title: '',
  slug: '',
  descriptionMd: '',
  color: '#4F6CFF',
  hidden: false,
  durationMinutes: 30,
  locationKind: 'google_meet',
  locationValue: '',
  destinationAccountId: '',
  destinationCalendarId: '',
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  minNoticeMin: 60,
  bookingWindowDays: 60,
  maxPerDay: '',
  maxPerWeek: '',
  maxGuests: 3,
  slotIntervalMin: 15,
  scheduleId: '',
  confirmationMd: '',
  redirectUrl: '',
  password: '',
  sendReminders: true,
  questions: [],
};

// ─────────────────────────────────────────────────────────────
// Slug helper (mirrors server-side slugify)
// ─────────────────────────────────────────────────────────────

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ─────────────────────────────────────────────────────────────
// URL preview chip — read-only label that flips into an inline editor.
// ─────────────────────────────────────────────────────────────

function UrlPreview({
  username,
  slug,
  onChange,
  onManualEdit,
  error,
}: {
  username: string;
  slug: string;
  onChange: (next: string) => void;
  onManualEdit: () => void;
  error?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slug);
  const [host, setHost] = useState<string | null>(null);

  // Resolve the host on the client only — keeps SSR markup stable so hydration
  // doesn't mismatch (server has no `window`).
  useEffect(() => {
    setHost(window.location.host);
  }, []);

  useEffect(() => {
    if (!editing) setDraft(slug);
  }, [slug, editing]);

  const commit = () => {
    const cleaned = slugify(draft);
    onChange(cleaned);
    setEditing(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
        <span className="text-muted-foreground">
          {host ?? ''}
          {host && '/'}
          {username}/
        </span>
        {editing ? (
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                setDraft(slug);
                setEditing(false);
              }
            }}
            className="min-w-[6ch] rounded-sm border border-primary bg-card px-2 py-0.5 text-sm text-foreground outline-none"
            aria-label="Edit slug"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              onManualEdit();
              setEditing(true);
            }}
            className="group inline-flex items-center gap-1 rounded-sm border border-border bg-muted/50 px-2 py-0.5 text-sm text-foreground transition-colors hover:bg-muted hover:border-input"
            title="Click to edit slug"
          >
            <span className="font-mono">{slug || 'your-slug'}</span>
            <Pencil className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-foreground" />
          </button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Color swatch picker
// ─────────────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const isPreset = COLOR_SWATCHES.some((s) => s.hex.toLowerCase() === value.toLowerCase());

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Color</p>
      <div className="flex flex-wrap items-center gap-3">
        {COLOR_SWATCHES.map(({ hex, name }) => {
          const selected = value.toLowerCase() === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              onClick={() => onChange(hex)}
              title={name}
              aria-label={`Select ${name}`}
              aria-pressed={selected}
              className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${
                selected
                  ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                  : ''
              }`}
              style={{ backgroundColor: hex }}
            />
          );
        })}

        <label
          className={`relative inline-flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-input transition-transform hover:scale-110 ${
            !isPreset
              ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
              : ''
          }`}
          title="Custom color"
          style={!isPreset ? { backgroundColor: value, borderStyle: 'solid' } : undefined}
        >
          {isPreset && (
            <span className="text-xs text-muted-foreground">+</span>
          )}
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Custom color"
          />
        </label>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Form component
// ─────────────────────────────────────────────────────────────

export function EventTypeForm({
  mode,
  eventTypeId,
  username,
  initialValues,
  accounts,
  allCalendars,
  schedules,
}: EventTypeFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (payload: EventTypeUpsertPayload) =>
      mode === 'create'
        ? createEventType(payload)
        : updateEventType(eventTypeId as string, payload),
    onSuccess: () => {
      toast.success(mode === 'create' ? 'Event type created' : 'Event type saved');
      void queryClient.invalidateQueries({ queryKey: eventTypeKeys.all });
      router.push('/admin/event-types');
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const fieldErrors = err.body.issues?.fieldErrors;
        if (fieldErrors) {
          const next: Record<string, string> = {};
          for (const [field, msgs] of Object.entries(fieldErrors)) {
            next[field] = msgs?.[0] ?? 'Invalid value';
          }
          setErrors(next);
        }
        toast.error(err.message);
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Network error — please try again');
    },
  });

  const [values, setValues] = useState<EventTypeFormValues>({
    ...DEFAULT_VALUES,
    ...initialValues,
  });

  // In edit mode the slug is already set — never auto-overwrite from title.
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(mode === 'edit');

  const [durationMode, setDurationMode] = useState<string>(() => {
    const d = initialValues?.durationMinutes;
    if (!d) return '30';
    return DURATION_PRESETS.find((p) => p.value === String(d)) ? String(d) : 'custom';
  });

  // Min-notice unit (UI-only — the API stores minutes).
  const [noticeUnit, setNoticeUnit] = useState<'minutes' | 'hours'>(() => {
    const m = Number(initialValues?.minNoticeMin ?? 60);
    return m > 0 && m % 60 === 0 ? 'hours' : 'minutes';
  });
  const noticeDisplay =
    noticeUnit === 'hours' && typeof values.minNoticeMin === 'number'
      ? values.minNoticeMin / 60
      : values.minNoticeMin;

  const [errors, setErrors] = useState<Record<string, string>>({});
  const saving = saveMutation.isPending;

  // Derived option lists.
  const accountOptions = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: a.googleUserEmail })),
    [accounts],
  );

  const eligibleCalendars = useMemo(
    () =>
      allCalendars.filter(
        (c) => c.connectedAccountId === values.destinationAccountId && c.isDestinationEligible,
      ),
    [allCalendars, values.destinationAccountId],
  );
  const calendarOptions = eligibleCalendars.map((c) => ({ value: c.id, label: c.name }));

  const scheduleOptions = [
    { value: '', label: 'Default schedule' },
    ...schedules.map((s) => ({
      value: s.id,
      label: s.isDefault ? `${s.name} (default)` : s.name,
    })),
  ];

  // Auto-sync slug from title until manually edited.
  useEffect(() => {
    if (!slugManuallyEdited && values.title) {
      setValues((v) => ({ ...v, slug: slugify(v.title) }));
    }
  }, [values.title, slugManuallyEdited]);

  // When the account changes (after the first render), reset the calendar
  // selection so we don't leave a stale calendar from another account.
  // Skip on the first render so edit-mode preserves the persisted value.
  const prevAccountId = React.useRef(values.destinationAccountId);
  useEffect(() => {
    if (prevAccountId.current !== values.destinationAccountId) {
      prevAccountId.current = values.destinationAccountId;
      setValues((v) => ({ ...v, destinationCalendarId: '' }));
    }
  }, [values.destinationAccountId]);

  const set = useCallback(
    <K extends keyof EventTypeFormValues>(key: K, val: EventTypeFormValues[K]) => {
      setValues((v) => ({ ...v, [key]: val }));
      setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
    },
    [],
  );

  // ─── Questions ───

  const addQuestion = () =>
    setValues((v) => ({
      ...v,
      questions: [
        ...v.questions,
        {
          label: '',
          helperText: '',
          kind: 'text',
          required: false,
          optionsJson: '',
          position: v.questions.length,
        },
      ],
    }));

  const removeQuestion = (index: number) =>
    setValues((v) => ({ ...v, questions: v.questions.filter((_, i) => i !== index) }));

  const updateQuestion = (index: number, patch: Partial<QuestionFormValue>) =>
    setValues((v) => ({
      ...v,
      questions: v.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    }));

  // ─── Submit ───

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const durationMinutes =
      durationMode === 'custom' ? Number(values.durationMinutes) : Number(durationMode);

    const payload: EventTypeUpsertPayload = {
      title: values.title,
      slug: values.slug,
      descriptionMd: values.descriptionMd || null,
      color: values.color,
      hidden: values.hidden,
      durationMinutes,
      locationKind: values.locationKind,
      locationValue: values.locationValue || null,
      destinationAccountId: values.destinationAccountId,
      destinationCalendarId: values.destinationCalendarId,
      bufferBeforeMin: Number(values.bufferBeforeMin) || 0,
      bufferAfterMin: Number(values.bufferAfterMin) || 0,
      minNoticeMin: Number(values.minNoticeMin) || 0,
      bookingWindowDays: Number(values.bookingWindowDays) || 60,
      maxPerDay: values.maxPerDay === '' ? null : Number(values.maxPerDay),
      maxPerWeek: values.maxPerWeek === '' ? null : Number(values.maxPerWeek),
      maxGuests: values.maxGuests === '' ? 3 : Number(values.maxGuests),
      slotIntervalMin: Number(values.slotIntervalMin) || 15,
      scheduleId: values.scheduleId || null,
      confirmationMd: values.confirmationMd || null,
      redirectUrl: values.redirectUrl || null,
      password: values.password || null,
      sendReminders: values.sendReminders,
      questions: values.questions.map((q, i) => ({
        id: q.id,
        label: q.label,
        helperText: q.helperText || undefined,
        kind: q.kind,
        required: q.required,
        optionsJson: q.optionsJson || undefined,
        position: i,
      })),
    };

    saveMutation.mutate(payload);
  }

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  const noAccounts = accounts.length === 0;
  const accountSelected = Boolean(values.destinationAccountId);
  const noEligibleCalendars = accountSelected && calendarOptions.length === 0;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-24 md:pb-0">
      {/* ── Section 1: Basics ── */}
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-foreground">Basics</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="grid gap-2">
              <Label htmlFor="title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                value={values.title}
                onChange={(e) => set('title', e.target.value)}
                aria-invalid={Boolean(errors.title)}
                required
                autoFocus={mode === 'create'}
                placeholder="e.g. Discovery Call"
              />
              {errors.title ? (
                <p className="text-xs text-destructive">{errors.title}</p>
              ) : (
                <p className="text-xs text-muted-foreground">e.g. Discovery Call</p>
              )}
            </div>
            <UrlPreview
              username={username}
              slug={values.slug}
              onChange={(v) => set('slug', v)}
              onManualEdit={() => setSlugManuallyEdited(true)}
              error={errors.slug}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="descriptionMd">Description</Label>
            <Textarea
              id="descriptionMd"
              rows={3}
              value={values.descriptionMd}
              onChange={(e) => set('descriptionMd', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Markdown supported. Shown to bookers on the event page.
            </p>
          </div>

          <ColorPicker value={values.color} onChange={(v) => set('color', v)} />

          <div className="flex items-center gap-3">
            <Switch
              id="hidden"
              checked={values.hidden}
              onCheckedChange={(v) => set('hidden', v)}
            />
            <div className="flex flex-col">
              <Label htmlFor="hidden">Hidden</Label>
              <p className="text-xs text-muted-foreground">
                Hidden event types are not shown on your public profile, but bookers can still reach them via direct link.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 2: What you offer ── */}
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-foreground">What you offer</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="durationMode">Duration</Label>
              <Select
                value={durationMode}
                onValueChange={(v) => {
                  setDurationMode(v);
                  if (v !== 'custom') set('durationMinutes', Number(v));
                }}
              >
                <SelectTrigger id="durationMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_PRESETS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {durationMode === 'custom' && (
              <div className="grid gap-2">
                <Label htmlFor="customDuration">Custom duration (min)</Label>
                <Input
                  id="customDuration"
                  type="number"
                  value={String(values.durationMinutes)}
                  onChange={(e) =>
                    set('durationMinutes', e.target.value === '' ? '' : Number(e.target.value))
                  }
                  aria-invalid={Boolean(errors.durationMinutes)}
                />
                {errors.durationMinutes && (
                  <p className="text-xs text-destructive">{errors.durationMinutes}</p>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="locationKind">Location</Label>
            <Select
              value={values.locationKind}
              onValueChange={(v) => set('locationKind', v as LocationKind)}
            >
              <SelectTrigger id="locationKind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCATION_KIND_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(values.locationKind === 'in_person' || values.locationKind === 'custom_link') && (
            <div className="duration-200 animate-in fade-in slide-in-from-top-1 grid gap-2">
              <Label htmlFor="locationValue">
                {values.locationKind === 'in_person' ? 'Address' : 'Meeting URL'}{' '}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="locationValue"
                value={values.locationValue}
                onChange={(e) => set('locationValue', e.target.value)}
                aria-invalid={Boolean(errors.locationValue)}
                required
              />
              {errors.locationValue && (
                <p className="text-xs text-destructive">{errors.locationValue}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Section 3: Where it lands ── */}
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-foreground">Where it lands</h2>
          <p className="text-sm text-muted-foreground">
            Bookings are created on this calendar.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {noAccounts ? (
            <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border bg-muted/50 p-5">
              <p className="text-sm text-muted-foreground">
                You haven&apos;t connected a Google account yet. Connect one to start
                receiving bookings.
              </p>
              <Button asChild variant="secondary" size="sm">
                <Link href="/admin/calendars">
                  <Calendar className="mr-1 h-4 w-4" />
                  Connect calendar
                </Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="destinationAccountId">
                  Account <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={values.destinationAccountId}
                  onValueChange={(v) => set('destinationAccountId', v)}
                >
                  <SelectTrigger
                    id="destinationAccountId"
                    aria-invalid={Boolean(errors.destinationAccountId)}
                  >
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accountOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.destinationAccountId && (
                  <p className="text-xs text-destructive">{errors.destinationAccountId}</p>
                )}
              </div>

              {noEligibleCalendars ? (
                <div className="rounded-md border border-dashed border-border bg-muted/50 p-4 text-sm text-muted-foreground">
                  No calendars on this account are marked as a booking destination yet.{' '}
                  <Link
                    href="/admin/calendars"
                    className="text-primary underline underline-offset-2 hover:opacity-90"
                  >
                    Mark a calendar as Destination
                  </Link>
                  .
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="destinationCalendarId">
                    {accountSelected ? 'Calendar' : 'Calendar — pick an account first'}{' '}
                    {accountSelected && <span className="text-destructive">*</span>}
                  </Label>
                  <Select
                    value={values.destinationCalendarId}
                    onValueChange={(v) => set('destinationCalendarId', v)}
                    disabled={!accountSelected}
                  >
                    <SelectTrigger
                      id="destinationCalendarId"
                      aria-invalid={Boolean(errors.destinationCalendarId)}
                    >
                      <SelectValue placeholder="Select calendar" />
                    </SelectTrigger>
                    <SelectContent>
                      {calendarOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.destinationCalendarId && (
                    <p className="text-xs text-destructive">{errors.destinationCalendarId}</p>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Section 4: Custom questions ── */}
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-foreground">Custom questions</h2>
          <p className="text-sm text-muted-foreground">
            Optional. Ask bookers anything you need before the meeting.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {values.questions.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
              Ask bookers anything you need to know — name, project info, phone…
            </p>
          ) : (
            values.questions.map((q, i) => (
              <div
                key={i}
                className="flex flex-col gap-3 rounded-md border border-border p-3"
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
                  <div className="grid gap-2">
                    <Label htmlFor={`question-${i}`}>
                      Question {i + 1} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id={`question-${i}`}
                      value={q.label}
                      onChange={(e) => updateQuestion(i, { label: e.target.value })}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`question-kind-${i}`}>Type</Label>
                    <Select
                      value={q.kind}
                      onValueChange={(v) => updateQuestion(i, { kind: v as QuestionKind })}
                    >
                      <SelectTrigger id={`question-kind-${i}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUESTION_KIND_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end justify-end pb-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove question"
                      onClick={() => removeQuestion(i)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </Button>
                  </div>
                </div>

                {(q.kind === 'select' || q.kind === 'radio') && (
                  <div className="grid gap-2">
                    <Label htmlFor={`question-options-${i}`}>Options (comma-separated)</Label>
                    <Input
                      id={`question-options-${i}`}
                      value={q.optionsJson}
                      onChange={(e) => updateQuestion(i, { optionsJson: e.target.value })}
                      placeholder='e.g. "Option A, Option B, Option C"'
                    />
                    <p className="text-xs text-muted-foreground">
                      e.g. &quot;Option A, Option B, Option C&quot;
                    </p>
                  </div>
                )}

                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={q.required}
                    onCheckedChange={(v) => updateQuestion(i, { required: Boolean(v) })}
                  />
                  Required
                </label>
              </div>
            ))
          )}

          <div>
            <Button type="button" variant="outline" size="sm" onClick={addQuestion}>
              <Plus className="mr-1 h-4 w-4" />
              Add question
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 5: Advanced (collapsed) ── */}
      <Card>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4 text-foreground transition-colors hover:bg-foreground/[0.04]">
            <div className="flex flex-col">
              <span className="text-xl font-semibold">Advanced</span>
              <span className="text-xs text-muted-foreground">
                Buffers, limits, schedule, password, redirect…
              </span>
            </div>
            <ChevronDown className="h-6 w-6 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>

          <div className="flex flex-col gap-5 px-4 pb-4">
            {/* Buffers */}
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Buffers (minutes)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="bufferBeforeMin">Before</Label>
                  <Input
                    id="bufferBeforeMin"
                    type="number"
                    value={String(values.bufferBeforeMin)}
                    onChange={(e) =>
                      set('bufferBeforeMin', e.target.value === '' ? '' : Number(e.target.value))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="bufferAfterMin">After</Label>
                  <Input
                    id="bufferAfterMin"
                    type="number"
                    value={String(values.bufferAfterMin)}
                    onChange={(e) =>
                      set('bufferAfterMin', e.target.value === '' ? '' : Number(e.target.value))
                    }
                  />
                </div>
              </div>
            </div>

            {/* Min notice */}
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Minimum notice</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="noticeDisplay">Notice</Label>
                  <Input
                    id="noticeDisplay"
                    type="number"
                    value={String(noticeDisplay)}
                    onChange={(e) => {
                      const n = e.target.value === '' ? '' : Number(e.target.value);
                      if (n === '') set('minNoticeMin', '');
                      else set('minNoticeMin', noticeUnit === 'hours' ? (n as number) * 60 : (n as number));
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="noticeUnit">Unit</Label>
                  <Select
                    value={noticeUnit}
                    onValueChange={(v) => {
                      setNoticeUnit(v as 'minutes' | 'hours');
                    }}
                  >
                    <SelectTrigger id="noticeUnit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MIN_NOTICE_UNITS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Booking window */}
            <div className="grid gap-2">
              <Label htmlFor="bookingWindowDays">Booking window (days)</Label>
              <Input
                id="bookingWindowDays"
                type="number"
                value={String(values.bookingWindowDays)}
                onChange={(e) =>
                  set('bookingWindowDays', e.target.value === '' ? '' : Number(e.target.value))
                }
              />
              <p className="text-xs text-muted-foreground">
                How far into the future bookings can be made
              </p>
            </div>

            {/* Frequency limits */}
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Frequency limits</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="maxPerDay">Max per day</Label>
                  <Input
                    id="maxPerDay"
                    type="number"
                    value={String(values.maxPerDay)}
                    onChange={(e) =>
                      set('maxPerDay', e.target.value === '' ? '' : Number(e.target.value))
                    }
                    placeholder="Unlimited"
                  />
                  <p className="text-xs text-muted-foreground">Blank = unlimited</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="maxPerWeek">Max per week</Label>
                  <Input
                    id="maxPerWeek"
                    type="number"
                    value={String(values.maxPerWeek)}
                    onChange={(e) =>
                      set('maxPerWeek', e.target.value === '' ? '' : Number(e.target.value))
                    }
                    placeholder="Unlimited"
                  />
                  <p className="text-xs text-muted-foreground">Blank = unlimited</p>
                </div>
              </div>
            </div>

            {/* Guest cap */}
            <div className="grid gap-2">
              <Label htmlFor="maxGuests">Max additional guests</Label>
              <Input
                id="maxGuests"
                type="number"
                min={0}
                max={20}
                value={String(values.maxGuests)}
                onChange={(e) =>
                  set('maxGuests', e.target.value === '' ? '' : Number(e.target.value))
                }
                aria-invalid={Boolean(errors.maxGuests)}
              />
              {errors.maxGuests ? (
                <p className="text-xs text-destructive">{errors.maxGuests}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  How many extra people the booker can invite. Set to 0 for 1:1 only.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="slotIntervalMin">Slot interval</Label>
              <Select
                value={String(values.slotIntervalMin)}
                onValueChange={(v) => set('slotIntervalMin', Number(v))}
              >
                <SelectTrigger id="slotIntervalMin">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLOT_INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Granularity of offered start times</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="scheduleId">Schedule</Label>
              <Select
                value={values.scheduleId || '__default__'}
                onValueChange={(v) => set('scheduleId', v === '__default__' ? '' : v)}
              >
                <SelectTrigger id="scheduleId">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scheduleOptions.map((opt) => (
                    <SelectItem key={opt.value || '__default__'} value={opt.value || '__default__'}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="confirmationMd">Confirmation message</Label>
              <Textarea
                id="confirmationMd"
                rows={3}
                value={values.confirmationMd}
                onChange={(e) => set('confirmationMd', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Markdown. Shown after booking and in the confirmation email.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="redirectUrl">Redirect URL</Label>
              <Input
                id="redirectUrl"
                value={values.redirectUrl}
                onChange={(e) => set('redirectUrl', e.target.value)}
                aria-invalid={Boolean(errors.redirectUrl)}
              />
              {errors.redirectUrl ? (
                <p className="text-xs text-destructive">{errors.redirectUrl}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Optional. Booker is redirected here after booking.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={values.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder={
                  mode === 'edit' ? 'Leave blank to keep current' : 'Leave blank for no password'
                }
              />
              <p className="text-xs text-muted-foreground">
                If set, bookers must enter this password to view the booking page
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="sendReminders"
                checked={values.sendReminders}
                onCheckedChange={(v) => set('sendReminders', v)}
              />
              <div className="flex flex-col">
                <Label htmlFor="sendReminders">Send reminder emails</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically email bookers ahead of the meeting.
                </p>
              </div>
            </div>
          </div>
        </details>
      </Card>

      {/* ── Submit bar ── */}
      <div
        className={
          'sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-border bg-muted/50 px-4 py-3 backdrop-blur ' +
          'md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none'
        }
      >
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push('/admin/event-types')}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : mode === 'create' ? 'Save event type' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
