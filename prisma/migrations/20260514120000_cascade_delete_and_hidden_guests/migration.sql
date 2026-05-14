-- Migration: cascade_delete_and_hidden_guests
-- 1) Bookings.event_type_id FK: ON DELETE RESTRICT -> ON DELETE CASCADE.
--    Deleting an EventType now drops its Bookings and (transitively) their
--    BookingHistory rows (BookingHistory.booking_id is already ON DELETE CASCADE).
--    BookingInvite.event_type_id is also already ON DELETE CASCADE.
-- 2) Adds `hidden_guests_json` to `event_types` (silent attendees added to every
--    booking on this event type) and to `booking_invites` (silent attendees for
--    the single booking that consumes the invite). The booker never sees these
--    in the booking form; the server merges them into Booking.additional_guests_json
--    on submit.
--
-- SQLite has no DROP/ADD CONSTRAINT, so the FK change requires the standard
-- table-recreate dance (PRAGMA foreign_keys=OFF, new table, copy, swap, indexes).

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_bookings" (
    "id"                       TEXT NOT NULL PRIMARY KEY,
    "event_type_id"            TEXT NOT NULL,
    "google_account_id"        TEXT NOT NULL,
    "google_calendar_id"       TEXT NOT NULL,
    "google_event_id"          TEXT,
    "start_at"                 DATETIME NOT NULL,
    "end_at"                   DATETIME NOT NULL,
    "status"                   TEXT NOT NULL DEFAULT 'confirmed',
    "booker_name"              TEXT NOT NULL,
    "booker_email"             TEXT NOT NULL,
    "booker_timezone"          TEXT NOT NULL,
    "additional_guests_json"   TEXT NOT NULL DEFAULT '[]',
    "notes"                    TEXT,
    "answers_json"             TEXT NOT NULL DEFAULT '{}',
    "cancel_token_hash"        TEXT NOT NULL,
    "reschedule_token_hash"    TEXT NOT NULL,
    "meeting_url"              TEXT,
    "no_show"                  BOOLEAN NOT NULL DEFAULT false,
    "client_request_id"        TEXT,
    "needs_sync"               BOOLEAN NOT NULL DEFAULT false,
    "sync_error"               TEXT,
    "created_at"               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at"             DATETIME,
    "cancel_reason"            TEXT,
    "updated_at"               DATETIME NOT NULL,
    CONSTRAINT "bookings_event_type_id_fkey"
        FOREIGN KEY ("event_type_id") REFERENCES "event_types" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bookings_google_account_id_fkey"
        FOREIGN KEY ("google_account_id") REFERENCES "connected_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_bookings" (
    "id", "event_type_id", "google_account_id", "google_calendar_id", "google_event_id",
    "start_at", "end_at", "status", "booker_name", "booker_email", "booker_timezone",
    "additional_guests_json", "notes", "answers_json", "cancel_token_hash",
    "reschedule_token_hash", "meeting_url", "no_show", "client_request_id",
    "needs_sync", "sync_error", "created_at", "cancelled_at", "cancel_reason", "updated_at"
)
SELECT
    "id", "event_type_id", "google_account_id", "google_calendar_id", "google_event_id",
    "start_at", "end_at", "status", "booker_name", "booker_email", "booker_timezone",
    "additional_guests_json", "notes", "answers_json", "cancel_token_hash",
    "reschedule_token_hash", "meeting_url", "no_show", "client_request_id",
    "needs_sync", "sync_error", "created_at", "cancelled_at", "cancel_reason", "updated_at"
FROM "bookings";

DROP TABLE "bookings";
ALTER TABLE "new_bookings" RENAME TO "bookings";

CREATE UNIQUE INDEX "bookings_event_type_id_client_request_id_key"
    ON "bookings"("event_type_id", "client_request_id");
CREATE INDEX "bookings_start_at_end_at_idx" ON "bookings"("start_at", "end_at");
CREATE INDEX "bookings_event_type_id_status_idx" ON "bookings"("event_type_id", "status");
CREATE INDEX "bookings_status_start_at_idx" ON "bookings"("status", "start_at");

PRAGMA foreign_keys=ON;

-- Hidden-guest columns. JSON array of lowercased emails. Default '[]' so
-- existing rows stay valid without a backfill step.
ALTER TABLE "event_types"     ADD COLUMN "hidden_guests_json" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "booking_invites" ADD COLUMN "hidden_guests_json" TEXT NOT NULL DEFAULT '[]';
