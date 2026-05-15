import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Reserved slugs that must not be used for event types.
// ─────────────────────────────────────────────────────────────
const RESERVED_SLUGS = new Set([
  'admin',
  'setup',
  'api',
  'b',
  'i',
  'avatars',
  '_next',
  'static',
  '',
]);

export const LOCATION_KINDS = ['google_meet', 'phone', 'in_person', 'custom_link'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const QUESTION_KINDS = ['text', 'textarea', 'select', 'checkbox', 'radio'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

const questionSchema = z.object({
  id: z.string().optional(), // present on update, absent on create
  label: z.string().min(1, 'Label is required').max(200),
  helperText: z.string().max(500).optional(),
  kind: z.enum(QUESTION_KINDS),
  required: z.boolean().default(false),
  optionsJson: z.string().optional(), // JSON array string for select/radio
  position: z.number().int().min(0).default(0),
});

export const eventTypeInputSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(100, 'Title must be 100 characters or fewer'),

    slug: z
      .string()
      .min(1, 'Slug is required')
      .max(60, 'Slug must be 60 characters or fewer')
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Slug must be lowercase alphanumeric with hyphens; no leading or trailing hyphens',
      )
      .refine((s) => !RESERVED_SLUGS.has(s), {
        message: 'This slug is reserved and cannot be used',
      }),

    descriptionMd: z.string().max(5000).optional().nullable(),

    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a 6-digit hex string like #4F6CFF')
      .default('#4F6CFF'),

    hidden: z.boolean().default(false),

    // When true, the slug-keyed public page and APIs return 404. The only
    // way in is /i/<token> with a valid one-time invite. Pairs with `hidden`
    // for full lockdown.
    inviteOnly: z.boolean().default(false),

    durationMinutes: z
      .number()
      .int()
      .positive('Duration must be positive')
      .max(1440, 'Duration cannot exceed 1440 minutes (24 hours)'),

    destinationAccountId: z.string().min(1, 'Destination account is required'),
    destinationCalendarId: z.string().min(1, 'Destination calendar is required'),

    locationKind: z.enum(LOCATION_KINDS),

    locationValue: z.string().max(2000).optional().nullable(),

    bufferBeforeMin: z.number().int().min(0).max(120).default(0),
    bufferAfterMin: z.number().int().min(0).max(120).default(0),

    minNoticeMin: z
      .number()
      .int()
      .min(0)
      .max(43200, 'Min notice cannot exceed 43200 minutes (30 days)')
      .default(60),

    bookingWindowDays: z
      .number()
      .int()
      .min(1, 'Booking window must be at least 1 day')
      .max(365, 'Booking window cannot exceed 365 days')
      .default(60),

    maxPerDay: z.number().int().positive().optional().nullable(),
    maxPerWeek: z.number().int().positive().optional().nullable(),

    maxGuests: z
      .number()
      .int()
      .min(0, 'Max guests cannot be negative')
      .max(20, 'Max guests cannot exceed 20')
      .default(3),

    slotIntervalMin: z
      .number()
      .int()
      .positive('Slot interval must be positive')
      .default(15),

    scheduleId: z.string().optional().nullable(),

    // Optional Brand override. null = unbranded (current behavior).
    brandId: z.string().optional().nullable(),

    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .optional()
      .nullable(),

    confirmationMd: z.string().max(5000).optional().nullable(),
    redirectUrl: z.string().url('Redirect URL must be a valid URL').optional().nullable(),

    sendReminders: z.boolean().default(true),

    // Emails silently added as attendees to every booking on this event type.
    // The booker never sees these in the booking form; the server merges them
    // into Booking.additional_guests_json on submit.
    hiddenGuests: z
      .array(z.string().trim().toLowerCase().email('Each hidden guest must be a valid email').max(320))
      .max(20, 'No more than 20 hidden guests')
      .default([]),

    questions: z.array(questionSchema).default([]),
  })
  .superRefine((data, ctx) => {
    // locationValue is required for in_person and custom_link
    if (data.locationKind === 'in_person' && !data.locationValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locationValue'],
        message: 'Address is required for in-person events',
      });
    }
    if (data.locationKind === 'custom_link') {
      if (!data.locationValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locationValue'],
          message: 'URL is required for custom link events',
        });
      } else {
        try {
          new URL(data.locationValue);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['locationValue'],
            message: 'Location value must be a valid URL for custom link events',
          });
        }
      }
    }
  });

export type EventTypeInput = z.infer<typeof eventTypeInputSchema>;
export type QuestionInput = z.infer<typeof questionSchema>;
