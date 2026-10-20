import { z } from 'zod';

/** Booker + guests must fit the booking's attendee cap (see booking/create.ts). */
export const MAX_POLL_PARTICIPANTS = 15;
/** Keeps the availability grid usable; enforced on the invitation's booking window. */
export const MAX_POLL_WINDOW_DAYS = 31;
/** Finest slot interval a group poll may use (the smallest option in the invitation form). */
export const MIN_POLL_SLOT_INTERVAL_MIN = 5;
/**
 * Largest grid a participant can paint: every slot of the poll window
 * (`pollWindow` adds a day for far-west zones) at the finest interval.
 */
export const MAX_POLL_VOTES = ((MAX_POLL_WINDOW_DAYS + 1) * 24 * 60) / MIN_POLL_SLOT_INTERVAL_MIN;

/** Per-invitation group-poll settings, part of the one-time invitation form. */
export const groupPollSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  showNames: z.boolean().default(true),
  allowGoogle: z.boolean().default(true),
  /** Who should answer. When all of them have, the poll is ready. */
  expected: z
    .array(z.string().trim().toLowerCase().email().max(320))
    .max(MAX_POLL_PARTICIPANTS)
    .default([])
    .transform((emails) => Array.from(new Set(emails))),
  /** Once this passes (with at least one answer), the poll is ready. */
  answerBy: z.string().datetime().nullable().default(null),
  /** When ready, book the best time if it works for everyone who answered. */
  autoBook: z.boolean().default(false),
});

export type GroupPollSettings = z.infer<typeof groupPollSettingsSchema>;

/** Most free-time ranges one answer may list (a month of busy days fits easily). */
export const MAX_POLL_RANGES = 500;

const instant = z.string().datetime({ offset: true });

/** Who is answering. */
export const pollParticipantDetailsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  timezone: z.string().min(1).max(100),
});

/**
 * A participant's answer, posted from the public poll page or by an AI
 * assistant. It must amount to at least one vote (checked against the
 * current candidates by the service). Exactly one of:
 *   - `votes`: the candidate slots the person can make, one by one;
 *   - `available`: time ranges the person is free. Every candidate that fits
 *     entirely inside a range gets that range's value. Anything not covered
 *     counts as "can't make it", so an incomplete calendar read can't turn
 *     into a false "yes".
 */
export const pollResponseSchema = pollParticipantDetailsSchema
  .extend({
    votes: z
      .array(
        z.object({
          startUtc: instant,
          value: z.enum(['yes', 'maybe']),
        }),
      )
      .max(MAX_POLL_VOTES)
      .optional(),
    available: z
      .array(
        z
          .object({
            start: instant,
            end: instant,
            value: z.enum(['yes', 'maybe']).default('yes'),
          })
          .refine((r) => Date.parse(r.end) > Date.parse(r.start), {
            message: 'end must be after start',
          }),
      )
      .max(MAX_POLL_RANGES)
      .optional(),
    // Lets a retried first answer update itself instead of adding a second
    // participant. Long and random, like any credential: a retry with it can
    // replace the answer.
    clientRequestId: z.string().min(16).max(100).optional(),
    // Self-reported provenance, shown to the owner, grants nothing: an AI
    // assistant, or a grid pre-filled by the Google import.
    via: z.enum(['agent', 'google']).optional(),
  })
  .refine((d) => (d.votes === undefined) !== (d.available === undefined), {
    message: 'Send exactly one of `votes` or `available`',
    path: ['votes'],
  });

export type PollResponseInput = z.infer<typeof pollResponseSchema>;

export const finalizePollSchema = z.object({
  startUtc: z.string().datetime(),
});
