import { z } from 'zod';

/** Booker + guests must fit the booking's attendee cap (see booking/create.ts). */
export const MAX_POLL_PARTICIPANTS = 15;
/** Keeps the availability grid usable; enforced on the invitation's booking window. */
export const MAX_POLL_WINDOW_DAYS = 31;
const MAX_VOTES = 3000;

/** Per-invitation group-poll settings, part of the one-time invitation form. */
export const groupPollSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  showNames: z.boolean().default(true),
  allowGoogle: z.boolean().default(true),
});

export type GroupPollSettings = z.infer<typeof groupPollSettingsSchema>;

/** A participant's answer, posted from the public poll page. */
export const pollResponseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  timezone: z.string().min(1).max(100),
  votes: z
    .array(
      z.object({
        startUtc: z.string().datetime(),
        value: z.enum(['yes', 'maybe']),
      }),
    )
    .max(MAX_VOTES),
});

export type PollResponseInput = z.infer<typeof pollResponseSchema>;

export const finalizePollSchema = z.object({
  startUtc: z.string().datetime(),
});
