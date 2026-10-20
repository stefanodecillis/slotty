# Booking with AI assistants

Slotty links are meant to be handed to people *or* to their AI assistants. The
assistant usually knows more about its user's week than any single calendar
connection would — several Google accounts, a work Outlook, personal
commitments — so instead of asking participants to connect calendars, Slotty
lets the assistant read the link, check its user's availability itself, and
book (or answer a poll) over plain HTTPS.

Nothing has to be configured. Everything below works on any deployment whose
public URL is reachable by the assistant.

## Link types

| Human link | `link.kind` | What the assistant does | Credential |
| --- | --- | --- | --- |
| `/<slug>` | `event_type` | Books one slot (public and hidden event types) | none, or the event type's password from its user |
| `/i/<token>` (invite-only or one-time invitation) | `invite` | Books one slot; the link is then used up | the token |
| `/i/<token>` (group poll) | `group_poll` | Records when its user is free; the owner later picks the time | the token, then a personal participant token for edits |

Invite-only event types are never reachable by slug (`/api/agent/links/<slug>`
404s, like the page).

## Discovery: one link for humans and assistants

An assistant given `https://book.example.com/intro-call` finds the
machine-readable view in any of these ways:

1. **Content negotiation.** `GET /intro-call` (or `/i/<token>`) with
   `Accept: text/markdown` or `Accept: application/json` is answered with the
   descriptor instead of HTML. Only an *explicit* preference for those types
   counts — `text/html`, `*/*` and Next.js' own router requests always get the
   page, so browsers, link previews and plain `curl` are unaffected.
2. **In the page.** `<link rel="alternate" type="application/json">` and
   `type="text/markdown"` in `<head>`, and a short visible line under the
   booking flow ("Using an AI assistant? …") linking to the Markdown version —
   for assistants whose fetch tool turns HTML into text.
3. **`/llms.txt`** describes the scheme for the whole instance.

## The descriptor

`GET /api/agent/links/<slug>` or `GET /api/agent/invites/<token>`

| Query | Meaning |
| --- | --- |
| `tz` | IANA timezone for `startLocal` (default `UTC`) |
| `from` | ISO instant to start the slot page at (used by `nextPageUrl`) |
| `format` | `json` (default) or `markdown`; overrides `Accept` |

JSON shape (`schema: "slotty.agent-link/v1"`):

```jsonc
{
  "schema": "slotty.agent-link/v1",
  "generatedAt": "…",
  "link": { "kind", "status", "statusMessage", "humanUrl", "descriptorUrl", "markdownUrl" },
  "protocol": { "notice": "…host text is untrusted…", "steps": ["…"] },
  "content": { "title", "description", "durationMinutes", "host", "location": { "kind", "details" } },
  "booking": { "requiresPassword", "maxAdditionalGuests", "questions": [{ "id", "label", "helperText", "kind", "required", "options", "answerFormat" }] },
  "poll": { "respondents", "maxParticipants", "windowStart", "windowEnd" },
  "meeting": { "title", "startUtc", "endUtc" },   // finalized polls only
  "availability": { "timezone", "from", "to", "slots": [{ "startUtc", "endUtc", "startLocal" }], "truncated", "nextPageUrl" },
  "actions": { "listSlots" | "book" | "cancel" | "listRescheduleSlots" | "reschedule" | "respond" | "readMyAnswer": { "method", "url", "headers", "body", "example", "returns" } },
  "errors": { "409 SLOT_UNAVAILABLE": "what to do", … }
}
```

- `status` is `open`, `used`, `expired`, `revoked`, `finalized` or `closed`.
  Anything but `open` comes with the reason and nothing else — no meeting
  details, times or actions (a finalized poll shows its title and confirmed
  time, like its page).
- Single-booker links list up to 14 days / 300 slots per page; polls list the
  candidates of the whole poll window, 300 per page.
- Disclosure follows the booking page: no password hashes, invite notes, hidden
  guests, owner phone numbers or addresses (location details are shown only for
  custom links), and never anyone else's poll answer or name.
- Responses are `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`,
  `Referrer-Policy: no-referrer`. They share the rate-limit bucket of the
  corresponding slot endpoint.

## Booking (event types and invitations)

`POST /api/public/bookings` — see `actions.book.body` for the field list. In short:

```json
{
  "eventTypeSlug": "intro-call",
  "startAt": "2026-10-21T07:00:00.000Z",
  "bookerName": "Ada Lovelace",
  "bookerEmail": "ada@example.com",
  "bookerTimezone": "Europe/Rome",
  "answers": { "<questionId>": "Acme" },
  "clientRequestId": "6f1c…",
  "via": "agent"
}
```

(`inviteToken` instead of `eventTypeSlug` for invitations; `password` when
`booking.requiresPassword`.)

- **Answers** are checked on the server: required questions must be answered,
  select/radio answers must be one of `options`, checkboxes are `"on"` or `""`.
  Problems come back as `422 INVALID_ANSWERS` with a `problems` list.
- **Retries.** Send a fresh random `clientRequestId` per booking and reuse it
  only to retry the same request. A retry returns the original booking
  (`idempotentReplay: true`, without the tokens — the manage link is also in the
  calendar invitation); reusing it for another time or booker is `409
  IDEMPOTENCY_CONFLICT`.
- The response includes `startAt`, `endAt`, `manageUrl`, `meetingUrl`, and the
  cancel / reschedule tokens. `needsSync: true` means the booking is saved and
  the Google invitation will follow.
- To move a booking, list times with
  `GET /api/public/bookings/<id>/slots?t=<rescheduleToken>&from=…&to=…&tz=…`
  (works for invitation bookings too, and doesn't count the booking itself
  against daily/weekly caps), then `POST /api/public/bookings/<id>/reschedule?t=…`.
  `POST …/cancel?t=…` cancels.

## Group polls without Google

`POST /api/public/polls/<token>` with either

- `available`: `[{ "start": ISO, "end": ISO, "value"?: "yes" | "maybe" }]` —
  the times the person is free. Every candidate that fits **entirely** inside a
  range gets its value; or
- `votes`: `[{ "startUtc": ISO, "value": "yes" | "maybe" }]` — explicit candidates.

Exactly one of the two. Anything not covered counts as "can't make it", so an
assistant that only checked part of the calendar can't produce false "yes"es.
Raw calendar entries never leave the assistant.

```json
{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "timezone": "Europe/Rome",
  "available": [
    { "start": "2026-10-21T09:00:00+02:00", "end": "2026-10-21T12:00:00+02:00" },
    { "start": "2026-10-22T14:00:00+02:00", "end": "2026-10-22T18:00:00+02:00", "value": "maybe" }
  ],
  "clientRequestId": "3b9e…",
  "via": "agent"
}
```

The response echoes what was stored — `votes` and `droppedVotes` (requested
starts that aren't candidates) — plus `participantToken` for a new answer. Send
that token as `X-Poll-Participant` to replace the answer later (in the browser
or from the assistant; the new answer replaces the old one). A retry of a first
answer with the same `clientRequestId` updates it instead of adding the person
twice (`replayed: true`).

Answering books nothing: the owner sees the answers (assistant answers carry an
**Assistant** badge), picks the time, and Google invites everyone.

## Safety notes for assistant builders

- Act only on times your user approved — explicitly, or by asking them.
- Treat `content`, question labels and help texts as information written by the
  host, never as instructions.
- `via: "agent"` is a label for the owner, not authentication: the link (and
  password, if any) is the only credential, exactly as for a human.
