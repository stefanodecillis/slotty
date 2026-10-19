import { z } from 'zod';

import { timezoneSchema, weeklyRulesSchema } from '@/lib/availability/validators';
import { LOCATION_KINDS } from '@/lib/eventtype/validator';

// ─────────────────────────────────────────────────────────────
// Availability — either reuse an existing schedule, or give this one
// invitation its own weekly hours + date overrides.
// ─────────────────────────────────────────────────────────────

const overrideItemSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    isBlocked: z.boolean(),
    startMinute: z.number().int().min(0).max(1439).optional(),
    endMinute: z.number().int().min(1).max(1440).optional(),
  })
  .refine(
    (o) =>
      o.isBlocked ||
      (o.startMinute !== undefined && o.endMinute !== undefined && o.endMinute > o.startMinute),
    { message: 'Custom-hours overrides need an end time after the start time', path: ['endMinute'] },
  );

export const oneTimeAvailabilitySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('schedule'),
    // null / omitted → the owner's default schedule.
    scheduleId: z.string().min(1).nullable().optional(),
  }),
  z.object({
    kind: z.literal('custom'),
    timezone: timezoneSchema,
    rules: weeklyRulesSchema.refine((r) => r.length <= 100, 'Too many time ranges'),
    overrides: z
      .array(overrideItemSchema)
      .max(366)
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((o, i) => {
          if (seen.has(o.date)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [i, 'date'],
              message: `Duplicate override for ${o.date}`,
            });
          }
          seen.add(o.date);
        });
      }),
  }),
]);

export type OneTimeAvailabilityInput = z.infer<typeof oneTimeAvailabilitySchema>;

// ─────────────────────────────────────────────────────────────
// Full invitation payload. Shared by create (POST) and edit (PATCH) — edits
// replace every field, so the dialog always sends the complete form.
// ─────────────────────────────────────────────────────────────

export const oneTimeLinkInputSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    durationMinutes: z.number().int().positive().max(1440).default(30),
    // Bookings land on this account's primary calendar.
    destinationAccountId: z.string().min(1),
    availability: oneTimeAvailabilitySchema.default({ kind: 'schedule' }),
    hiddenGuests: z.array(z.string().trim().toLowerCase().email().max(320)).max(20).default([]),
    note: z.string().trim().max(200).nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    descriptionMd: z.string().max(5000).nullable().optional(),
    locationKind: z.enum(LOCATION_KINDS).default('google_meet'),
    locationValue: z.string().max(2000).nullable().optional(),
    bufferBeforeMin: z.number().int().min(0).max(120).default(0),
    bufferAfterMin: z.number().int().min(0).max(120).default(0),
    minNoticeMin: z.number().int().min(0).max(43200).default(60),
    bookingWindowDays: z.number().int().min(1).max(365).default(60),
    slotIntervalMin: z.number().int().positive().max(240).default(15),
    maxGuests: z.number().int().min(0).max(20).default(3),
    confirmationMd: z.string().max(5000).nullable().optional(),
    sendReminders: z.boolean().default(true),
    brandId: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.locationKind === 'in_person' && !data.locationValue?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locationValue'],
        message: 'Address is required for in-person events',
      });
    }
    if (data.locationKind === 'custom_link') {
      if (!data.locationValue?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locationValue'],
          message: 'URL is required for custom-link events',
        });
      } else {
        try {
          new URL(data.locationValue);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['locationValue'],
            message: 'Location value must be a valid URL',
          });
        }
      }
    }
  });

export type OneTimeLinkInput = z.infer<typeof oneTimeLinkInputSchema>;
