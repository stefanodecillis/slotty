'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Switch } from '@/components/ui/Switch';
import { Select } from '@/components/ui/Select';
import { useSnackbar } from '@/components/ui/Snackbar';
import { LOCATION_KINDS, QUESTION_KINDS } from '@/lib/eventtype/validator';
import type { LocationKind, QuestionKind } from '@/lib/eventtype/validator';

// ─────────────────────────────────────────────────────────────
// Types
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
  initialValues?: Partial<EventTypeFormValues>;
  accounts: ConnectedAccountOption[];
  allCalendars: CalendarOption[];
  schedules: ScheduleOption[];
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const DURATION_PRESETS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '90 minutes' },
  { value: 'custom', label: 'Custom...' },
];

const LOCATION_KIND_OPTIONS = [
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

const QUESTION_KIND_OPTIONS = QUESTION_KINDS.map((k) => ({ value: k, label: k }));

const COLOR_SWATCHES = [
  '#4F6CFF',
  '#E85D75',
  '#2DB974',
  '#F59E0B',
  '#8B5CF6',
  '#06B6D4',
  '#F97316',
  '#64748B',
];

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
// Form component
// ─────────────────────────────────────────────────────────────

export function EventTypeForm({
  mode,
  eventTypeId,
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
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(mode === 'edit');
  const [durationMode, setDurationMode] = useState<string>(() => {
    const d = initialValues?.durationMinutes;
    if (!d) return '30';
    const preset = DURATION_PRESETS.find((p) => p.value === String(d));
    return preset ? String(d) : 'custom';
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Filtered calendars for selected account
  const eligibleCalendars = allCalendars.filter(
    (c) => c.connectedAccountId === values.destinationAccountId && c.isDestinationEligible,
  );

  const calendarOptions = eligibleCalendars.map((c) => ({ value: c.id, label: c.name }));

  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: a.googleUserEmail,
  }));

  const scheduleOptions = [
    { value: '', label: 'Default schedule' },
    ...schedules.map((s) => ({
      value: s.id,
      label: s.isDefault ? `${s.name} (default)` : s.name,
    })),
  ];

  // Auto-generate slug from title when not manually edited
  useEffect(() => {
    if (!slugManuallyEdited && values.title) {
      setValues((v) => ({ ...v, slug: slugify(v.title) }));
    }
  }, [values.title, slugManuallyEdited]);

  // Reset calendar when account changes
  useEffect(() => {
    setValues((v) => ({ ...v, destinationCalendarId: '' }));
  }, [values.destinationAccountId]);

  const set = useCallback(<K extends keyof EventTypeFormValues>(key: K, val: EventTypeFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: val }));
    setErrors((e) => ({ ...e, [key]: '' }));
  }, []);

  // ─── Questions helpers ───

  function addQuestion() {
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
  }

  function removeQuestion(index: number) {
    setValues((v) => ({
      ...v,
      questions: v.questions.filter((_, i) => i !== index),
    }));
  }

  function updateQuestion(index: number, patch: Partial<QuestionFormValue>) {
    setValues((v) => ({
      ...v,
      questions: v.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    }));
  }

  // ─── Submit ───

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});

    const durationMinutes =
      durationMode === 'custom'
        ? Number(values.durationMinutes)
        : Number(durationMode);

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
      minNoticeMin: Number(values.minNoticeMin) ?? 60,
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
        const d = data as { error?: string; issues?: { fieldErrors?: Record<string, string[]> } };
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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* ── Basics ── */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Basics</h2>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-col gap-4">
            <TextField
              label="Title"
              required
              value={values.title}
              onChange={(v) => set('title', v)}
              error={Boolean(errors.title)}
              helperText={errors.title}
            />

            <div className="flex flex-col gap-1">
              <TextField
                label="Slug"
                required
                value={values.slug}
                onChange={(v) => {
                  setSlugManuallyEdited(true);
                  set('slug', v);
                }}
                error={Boolean(errors.slug)}
                helperText={
                  errors.slug ??
                  'This appears in your booking URL: /b/your-slug'
                }
              />
            </div>

            <TextField
              label="Description (Markdown)"
              multiline
              rows={4}
              value={values.descriptionMd}
              onChange={(v) => set('descriptionMd', v)}
              helperText="Shown to bookers on the event page"
            />

            {/* Color */}
            <div className="flex flex-col gap-2">
              <p className="text-label-m text-on-surface-variant">Color</p>
              <div className="flex flex-wrap gap-2">
                {COLOR_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => set('color', hex)}
                    className="h-8 w-8 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: hex,
                      borderColor: values.color === hex ? 'var(--md-sys-color-primary)' : 'transparent',
                    }}
                    aria-label={`Select color ${hex}`}
                  />
                ))}
                <input
                  type="color"
                  value={values.color}
                  onChange={(e) => set('color', e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded-full border border-outline"
                  title="Custom color"
                />
              </div>
            </div>

            {/* Hidden toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-body-m text-on-surface">Hidden</p>
                <p className="text-body-s text-on-surface-variant">
                  Hidden event types do not appear on your public profile but can still be booked via direct URL
                </p>
              </div>
              <Switch
                checked={values.hidden}
                onCheckedChange={(v) => set('hidden', v)}
                label="Hidden"
              />
            </div>
          </div>
        </Card.Content>
      </Card>

      {/* ── Duration & Location ── */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Duration &amp; Location</h2>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-col gap-4">
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
                label="Custom duration (minutes)"
                type="number"
                value={String(values.durationMinutes)}
                onChange={(v) => set('durationMinutes', v === '' ? '' : Number(v))}
                error={Boolean(errors.durationMinutes)}
                helperText={errors.durationMinutes}
              />
            )}

            <Select
              label="Location type"
              value={values.locationKind}
              onValueChange={(v) => set('locationKind', v as LocationKind)}
              options={LOCATION_KIND_OPTIONS}
            />

            {(values.locationKind === 'in_person' || values.locationKind === 'custom_link') && (
              <TextField
                label={values.locationKind === 'in_person' ? 'Address' : 'URL'}
                value={values.locationValue}
                onChange={(v) => set('locationValue', v)}
                error={Boolean(errors.locationValue)}
                helperText={errors.locationValue}
                required
              />
            )}
          </div>
        </Card.Content>
      </Card>

      {/* ── Destination ── */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Destination Calendar</h2>
          <p className="text-body-m text-on-surface-variant">
            Bookings will be created on this calendar.
          </p>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-col gap-4">
            {accounts.length === 0 ? (
              <p className="text-body-m text-on-surface-variant">
                No connected accounts.{' '}
                <a href="/admin/calendars" className="text-primary underline">
                  Connect a Google account
                </a>{' '}
                to continue.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <Select
                    label="Google account"
                    value={values.destinationAccountId}
                    onValueChange={(v) => set('destinationAccountId', v)}
                    options={accountOptions}
                    helperText={errors.destinationAccountId}
                  />
                  {errors.destinationAccountId && (
                    <p className="px-4 text-body-s text-error">{errors.destinationAccountId}</p>
                  )}
                </div>

                {values.destinationAccountId && calendarOptions.length === 0 ? (
                  <p className="text-body-m text-on-surface-variant">
                    No destination-eligible calendars on this account.{' '}
                    <a href="/admin/calendars" className="text-primary underline">
                      Enable a calendar as destination
                    </a>
                    .
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    <Select
                      label="Calendar"
                      value={values.destinationCalendarId}
                      onValueChange={(v) => set('destinationCalendarId', v)}
                      options={calendarOptions}
                      disabled={!values.destinationAccountId}
                    />
                    {errors.destinationCalendarId && (
                      <p className="px-4 text-body-s text-error">{errors.destinationCalendarId}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </Card.Content>
      </Card>

      {/* ── Scheduling ── */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Scheduling</h2>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-col gap-4">
            <Select
              label="Schedule"
              value={values.scheduleId}
              onValueChange={(v) => set('scheduleId', v)}
              options={scheduleOptions}
            />

            <div className="grid grid-cols-2 gap-4">
              <TextField
                label="Buffer before (min)"
                type="number"
                value={String(values.bufferBeforeMin)}
                onChange={(v) => set('bufferBeforeMin', v === '' ? '' : Number(v))}
                helperText="0-120"
              />
              <TextField
                label="Buffer after (min)"
                type="number"
                value={String(values.bufferAfterMin)}
                onChange={(v) => set('bufferAfterMin', v === '' ? '' : Number(v))}
                helperText="0-120"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <TextField
                label="Min notice (min)"
                type="number"
                value={String(values.minNoticeMin)}
                onChange={(v) => set('minNoticeMin', v === '' ? '' : Number(v))}
                helperText="How far ahead bookings must be made"
              />
              <TextField
                label="Booking window (days)"
                type="number"
                value={String(values.bookingWindowDays)}
                onChange={(v) => set('bookingWindowDays', v === '' ? '' : Number(v))}
                helperText="How far into the future"
              />
            </div>

            <Select
              label="Slot interval"
              value={String(values.slotIntervalMin)}
              onValueChange={(v) => set('slotIntervalMin', Number(v))}
              options={SLOT_INTERVAL_OPTIONS}
              helperText="Granularity of offered start times"
            />
          </div>
        </Card.Content>
      </Card>

      {/* ── Limits ── */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Frequency Limits</h2>
        </Card.Header>
        <Card.Content>
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label="Max per day"
              type="number"
              value={String(values.maxPerDay)}
              onChange={(v) => set('maxPerDay', v === '' ? '' : Number(v))}
              helperText="Leave blank for unlimited"
            />
            <TextField
              label="Max per week"
              type="number"
              value={String(values.maxPerWeek)}
              onChange={(v) => set('maxPerWeek', v === '' ? '' : Number(v))}
              helperText="Leave blank for unlimited"
            />
          </div>
        </Card.Content>
      </Card>

      {/* ── Custom Questions ── */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Custom Questions</h2>
          <p className="text-body-m text-on-surface-variant">
            Ask bookers additional questions during checkout.
          </p>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-col gap-4">
            {values.questions.map((q, i) => (
              <div
                key={i}
                className="flex flex-col gap-3 rounded-shape-sm border border-outline-variant p-4"
              >
                <div className="flex items-start justify-between">
                  <p className="text-label-m text-on-surface">Question {i + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeQuestion(i)}
                    className="text-on-surface-variant hover:text-error"
                    aria-label="Remove question"
                  >
                    <span className="material-symbols-outlined text-[20px]">delete</span>
                  </button>
                </div>

                <TextField
                  label="Label"
                  required
                  value={q.label}
                  onChange={(v) => updateQuestion(i, { label: v })}
                />

                <Select
                  label="Kind"
                  value={q.kind}
                  onValueChange={(v) => updateQuestion(i, { kind: v as QuestionKind })}
                  options={QUESTION_KIND_OPTIONS}
                />

                <TextField
                  label="Helper text"
                  value={q.helperText}
                  onChange={(v) => updateQuestion(i, { helperText: v })}
                />

                {(q.kind === 'select' || q.kind === 'radio') && (
                  <TextField
                    label="Options (comma-separated)"
                    value={q.optionsJson}
                    onChange={(v) => updateQuestion(i, { optionsJson: v })}
                    helperText='e.g. "Option A, Option B, Option C"'
                  />
                )}

                <div className="flex items-center gap-3">
                  <Switch
                    checked={q.required}
                    onCheckedChange={(v) => updateQuestion(i, { required: v })}
                    label="Required"
                  />
                  <p className="text-body-s text-on-surface-variant">Required</p>
                </div>
              </div>
            ))}

            <Button type="button" variant="outlined" size="default" onClick={addQuestion}>
              <span className="material-symbols-outlined mr-1 text-[18px]">add</span>
              Add question
            </Button>
          </div>
        </Card.Content>
      </Card>

      {/* ── Confirmation ── */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Confirmation</h2>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-col gap-4">
            <TextField
              label="Confirmation message (Markdown)"
              multiline
              rows={4}
              value={values.confirmationMd}
              onChange={(v) => set('confirmationMd', v)}
              helperText="Shown after booking and included in confirmation email"
            />

            <TextField
              label="Redirect URL (optional)"
              value={values.redirectUrl}
              onChange={(v) => set('redirectUrl', v)}
              error={Boolean(errors.redirectUrl)}
              helperText={errors.redirectUrl ?? 'Redirect booker here after completing the booking'}
            />
          </div>
        </Card.Content>
      </Card>

      {/* ── Privacy ── */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Privacy</h2>
        </Card.Header>
        <Card.Content>
          <TextField
            label="Password"
            type="password"
            value={values.password}
            onChange={(v) => set('password', v)}
            placeholder={mode === 'edit' ? 'Leave blank to keep current' : ''}
            helperText="If set, bookers must enter this password to view the booking page"
          />
        </Card.Content>
      </Card>

      {/* ── Notifications ── */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-headline-s text-on-surface">Notifications</h2>
        </Card.Header>
        <Card.Content>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-body-m text-on-surface">Send reminders</p>
              <p className="text-body-s text-on-surface-variant">
                Send automated reminder emails to bookers before the event
              </p>
            </div>
            <Switch
              checked={values.sendReminders}
              onCheckedChange={(v) => set('sendReminders', v)}
              label="Send reminders"
            />
          </div>
        </Card.Content>
      </Card>

      {/* ── Actions ── */}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outlined"
          onClick={() => router.push('/admin/event-types')}
        >
          Cancel
        </Button>
        <Button type="submit" variant="filled" disabled={saving}>
          {saving ? 'Saving...' : mode === 'create' ? 'Create event type' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
