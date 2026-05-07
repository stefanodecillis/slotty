'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Switch } from '@/components/ui/Switch';
import { Select } from '@/components/ui/Select';
import { IconButton } from '@/components/ui/IconButton';
import { Checkbox } from '@/components/ui/Checkbox';
import { useSnackbar } from '@/components/ui/Snackbar';
import { QUESTION_KINDS } from '@/lib/eventtype/validator';
import type { LocationKind, QuestionKind } from '@/lib/eventtype/validator';

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
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-body-m">
        <span className="text-on-surface-variant">
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
            className="min-w-[6ch] rounded-shape-xs border border-primary bg-surface px-2 py-0.5 text-body-m text-on-surface outline-none"
            aria-label="Edit slug"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              onManualEdit();
              setEditing(true);
            }}
            className="group inline-flex items-center gap-1 rounded-shape-xs border border-outline-variant bg-surface-container-low px-2 py-0.5 text-body-m text-on-surface transition-colors hover:bg-surface-container hover:border-outline"
            title="Click to edit slug"
          >
            <span className="font-mono">{slug || 'your-slug'}</span>
            <span className="material-symbols-outlined text-[14px] text-on-surface-variant transition-colors group-hover:text-on-surface">
              edit
            </span>
          </button>
        )}
      </div>
      {error && <p className="text-body-s text-error">{error}</p>}
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
      <p className="text-label-m text-on-surface-variant">Color</p>
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
                  ? 'ring-2 ring-on-surface ring-offset-2 ring-offset-surface-container-low'
                  : ''
              }`}
              style={{ backgroundColor: hex }}
            />
          );
        })}

        <label
          className={`relative inline-flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-outline transition-transform hover:scale-110 ${
            !isPreset
              ? 'ring-2 ring-on-surface ring-offset-2 ring-offset-surface-container-low'
              : ''
          }`}
          title="Custom color"
          style={!isPreset ? { backgroundColor: value, borderStyle: 'solid' } : undefined}
        >
          {isPreset && (
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
              colorize
            </span>
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
  const { show } = useSnackbar();

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
  const [saving, setSaving] = useState(false);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});

    const durationMinutes =
      durationMode === 'custom' ? Number(values.durationMinutes) : Number(durationMode);

    const payload = {
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

    try {
      const url =
        mode === 'create'
          ? '/api/admin/event-types'
          : `/api/admin/event-types/${eventTypeId}`;
      const method = mode === 'create' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data: unknown = await res.json();

      if (!res.ok) {
        const d = data as {
          error?: string;
          issues?: { fieldErrors?: Record<string, string[]> };
        };
        if (d.issues?.fieldErrors) {
          const fieldErrors: Record<string, string> = {};
          for (const [field, msgs] of Object.entries(d.issues.fieldErrors)) {
            fieldErrors[field] = (msgs as string[])[0] ?? 'Invalid value';
          }
          setErrors(fieldErrors);
        }
        show({ message: d.error ?? 'Failed to save event type' });
        return;
      }

      show({ message: mode === 'create' ? 'Event type created' : 'Event type saved' });
      router.push('/admin/event-types');
    } catch {
      show({ message: 'Network error — please try again' });
    } finally {
      setSaving(false);
    }
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
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Basics</h2>
        </Card.Header>
        <Card.Content className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <TextField
              label="Title"
              required
              value={values.title}
              onChange={(v) => set('title', v)}
              error={Boolean(errors.title)}
              helperText={errors.title ?? 'e.g. Discovery Call'}
              autoFocus={mode === 'create'}
            />
            <UrlPreview
              username={username}
              slug={values.slug}
              onChange={(v) => set('slug', v)}
              onManualEdit={() => setSlugManuallyEdited(true)}
              error={errors.slug}
            />
          </div>

          <TextField
            label="Description"
            multiline
            rows={3}
            value={values.descriptionMd}
            onChange={(v) => set('descriptionMd', v)}
            helperText="Markdown supported. Shown to bookers on the event page."
          />

          <ColorPicker value={values.color} onChange={(v) => set('color', v)} />

          <Switch
            checked={values.hidden}
            onCheckedChange={(v) => set('hidden', v)}
            label="Hidden"
            description="Hidden event types are not shown on your public profile, but bookers can still reach them via direct link."
          />
        </Card.Content>
      </Card>

      {/* ── Section 2: What you offer ── */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">What you offer</h2>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Duration"
              value={durationMode}
              onValueChange={(v) => {
                setDurationMode(v);
                if (v !== 'custom') set('durationMinutes', Number(v));
              }}
              options={DURATION_PRESETS}
            />
            {durationMode === 'custom' && (
              <TextField
                label="Custom duration (min)"
                type="number"
                value={String(values.durationMinutes)}
                onChange={(v) => set('durationMinutes', v === '' ? '' : Number(v))}
                error={Boolean(errors.durationMinutes)}
                helperText={errors.durationMinutes}
              />
            )}
          </div>

          <Select
            label="Location"
            value={values.locationKind}
            onValueChange={(v) => set('locationKind', v as LocationKind)}
            options={LOCATION_KIND_OPTIONS}
          />

          {(values.locationKind === 'in_person' || values.locationKind === 'custom_link') && (
            <div className="duration-200 animate-in fade-in slide-in-from-top-1">
              <TextField
                label={values.locationKind === 'in_person' ? 'Address' : 'Meeting URL'}
                value={values.locationValue}
                onChange={(v) => set('locationValue', v)}
                error={Boolean(errors.locationValue)}
                helperText={errors.locationValue}
                required
              />
            </div>
          )}
        </Card.Content>
      </Card>

      {/* ── Section 3: Where it lands ── */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Where it lands</h2>
          <p className="text-body-m text-on-surface-variant">
            Bookings are created on this calendar.
          </p>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          {noAccounts ? (
            <div className="flex flex-col items-start gap-3 rounded-shape-sm border border-dashed border-outline-variant bg-surface-container-low p-5">
              <p className="text-body-m text-on-surface-variant">
                You haven&apos;t connected a Google account yet. Connect one to start
                receiving bookings.
              </p>
              <Button asChild variant="tonal" size="sm">
                <Link href="/admin/calendars">
                  <span className="material-symbols-outlined mr-1 text-[18px]">
                    calendar_today
                  </span>
                  Connect calendar
                </Link>
              </Button>
            </div>
          ) : (
            <>
              <Select
                label="Account"
                value={values.destinationAccountId}
                onValueChange={(v) => set('destinationAccountId', v)}
                options={accountOptions}
                error={Boolean(errors.destinationAccountId)}
                helperText={errors.destinationAccountId}
                required
              />

              {noEligibleCalendars ? (
                <div className="rounded-shape-sm border border-dashed border-outline-variant bg-surface-container-low p-4 text-body-m text-on-surface-variant">
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
                <Select
                  label={accountSelected ? 'Calendar' : 'Calendar — pick an account first'}
                  value={values.destinationCalendarId}
                  onValueChange={(v) => set('destinationCalendarId', v)}
                  options={calendarOptions}
                  disabled={!accountSelected}
                  error={Boolean(errors.destinationCalendarId)}
                  helperText={errors.destinationCalendarId}
                  required
                />
              )}
            </>
          )}
        </Card.Content>
      </Card>

      {/* ── Section 4: Custom questions ── */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Custom questions</h2>
          <p className="text-body-m text-on-surface-variant">
            Optional. Ask bookers anything you need before the meeting.
          </p>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          {values.questions.length === 0 ? (
            <p className="rounded-shape-sm border border-dashed border-outline-variant bg-surface-container-low px-4 py-6 text-center text-body-m text-on-surface-variant">
              Ask bookers anything you need to know — name, project info, phone…
            </p>
          ) : (
            values.questions.map((q, i) => (
              <div
                key={i}
                className="flex flex-col gap-3 rounded-shape-sm border border-outline-variant p-3"
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
                  <TextField
                    label={`Question ${i + 1}`}
                    required
                    value={q.label}
                    onChange={(v) => updateQuestion(i, { label: v })}
                  />
                  <Select
                    label="Type"
                    value={q.kind}
                    onValueChange={(v) => updateQuestion(i, { kind: v as QuestionKind })}
                    options={QUESTION_KIND_OPTIONS}
                  />
                  <div className="flex items-center justify-end">
                    <IconButton
                      type="button"
                      variant="standard"
                      label="Remove question"
                      onClick={() => removeQuestion(i)}
                    >
                      delete
                    </IconButton>
                  </div>
                </div>

                {(q.kind === 'select' || q.kind === 'radio') && (
                  <TextField
                    label="Options (comma-separated)"
                    value={q.optionsJson}
                    onChange={(v) => updateQuestion(i, { optionsJson: v })}
                    helperText='e.g. "Option A, Option B, Option C"'
                  />
                )}

                <label className="flex cursor-pointer items-center gap-2 text-body-m text-on-surface">
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
            <Button type="button" variant="outlined" size="sm" onClick={addQuestion}>
              <span className="material-symbols-outlined mr-1 text-[18px]">add</span>
              Add question
            </Button>
          </div>
        </Card.Content>
      </Card>

      {/* ── Section 5: Advanced (collapsed) ── */}
      <Card variant="outlined">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4 text-on-surface transition-colors hover:bg-on-surface/[0.04]">
            <div className="flex flex-col">
              <span className="text-headline-s">Advanced</span>
              <span className="text-body-s text-on-surface-variant">
                Buffers, limits, schedule, password, redirect…
              </span>
            </div>
            <span className="material-symbols-outlined text-[24px] text-on-surface-variant transition-transform group-open:rotate-180">
              expand_more
            </span>
          </summary>

          <div className="flex flex-col gap-5 px-4 pb-4">
            {/* Buffers */}
            <div>
              <p className="mb-2 text-label-m text-on-surface-variant">Buffers (minutes)</p>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Before"
                  type="number"
                  value={String(values.bufferBeforeMin)}
                  onChange={(v) =>
                    set('bufferBeforeMin', v === '' ? '' : Number(v))
                  }
                />
                <TextField
                  label="After"
                  type="number"
                  value={String(values.bufferAfterMin)}
                  onChange={(v) =>
                    set('bufferAfterMin', v === '' ? '' : Number(v))
                  }
                />
              </div>
            </div>

            {/* Min notice */}
            <div>
              <p className="mb-2 text-label-m text-on-surface-variant">Minimum notice</p>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Notice"
                  type="number"
                  value={String(noticeDisplay)}
                  onChange={(v) => {
                    const n = v === '' ? '' : Number(v);
                    if (n === '') set('minNoticeMin', '');
                    else set('minNoticeMin', noticeUnit === 'hours' ? n * 60 : n);
                  }}
                />
                <Select
                  label="Unit"
                  value={noticeUnit}
                  onValueChange={(v) => {
                    const next = v as 'minutes' | 'hours';
                    // Re-base the stored minutes when unit changes.
                    if (typeof values.minNoticeMin === 'number') {
                      // Keep minute storage stable; just change display.
                    }
                    setNoticeUnit(next);
                  }}
                  options={MIN_NOTICE_UNITS}
                />
              </div>
            </div>

            {/* Booking window */}
            <TextField
              label="Booking window (days)"
              type="number"
              value={String(values.bookingWindowDays)}
              onChange={(v) => set('bookingWindowDays', v === '' ? '' : Number(v))}
              helperText="How far into the future bookings can be made"
            />

            {/* Frequency limits */}
            <div>
              <p className="mb-2 text-label-m text-on-surface-variant">Frequency limits</p>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Max per day"
                  type="number"
                  value={String(values.maxPerDay)}
                  onChange={(v) => set('maxPerDay', v === '' ? '' : Number(v))}
                  helperText="Blank = unlimited"
                />
                <TextField
                  label="Max per week"
                  type="number"
                  value={String(values.maxPerWeek)}
                  onChange={(v) => set('maxPerWeek', v === '' ? '' : Number(v))}
                  helperText="Blank = unlimited"
                />
              </div>
            </div>

            <Select
              label="Slot interval"
              value={String(values.slotIntervalMin)}
              onValueChange={(v) => set('slotIntervalMin', Number(v))}
              options={SLOT_INTERVAL_OPTIONS}
              helperText="Granularity of offered start times"
            />

            <Select
              label="Schedule"
              value={values.scheduleId}
              onValueChange={(v) => set('scheduleId', v)}
              options={scheduleOptions}
            />

            <TextField
              label="Confirmation message"
              multiline
              rows={3}
              value={values.confirmationMd}
              onChange={(v) => set('confirmationMd', v)}
              helperText="Markdown. Shown after booking and in the confirmation email."
            />

            <TextField
              label="Redirect URL"
              value={values.redirectUrl}
              onChange={(v) => set('redirectUrl', v)}
              error={Boolean(errors.redirectUrl)}
              helperText={errors.redirectUrl ?? 'Optional. Booker is redirected here after booking.'}
            />

            <TextField
              label="Password"
              type="password"
              value={values.password}
              onChange={(v) => set('password', v)}
              placeholder={mode === 'edit' ? 'Leave blank to keep current' : 'Leave blank for no password'}
              helperText="If set, bookers must enter this password to view the booking page"
            />

            <Switch
              checked={values.sendReminders}
              onCheckedChange={(v) => set('sendReminders', v)}
              label="Send reminder emails"
              description="Automatically email bookers ahead of the meeting."
            />
          </div>
        </details>
      </Card>

      {/* ── Submit bar ── */}
      <div
        className={
          'sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-outline-variant bg-surface-container-low/95 px-4 py-3 backdrop-blur ' +
          'md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none'
        }
      >
        <Button
          type="button"
          variant="text"
          onClick={() => router.push('/admin/event-types')}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button type="submit" variant="filled" loading={saving} disabled={saving}>
          {mode === 'create' ? 'Save event type' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
