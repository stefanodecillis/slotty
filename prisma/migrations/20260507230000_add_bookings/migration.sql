-- Migration: add_bookings
-- Phase 7: Booking and BookingHistory tables.
-- These hold confirmed bookings against an EventType + destination calendar.
-- Cancel and reschedule tokens are stored as sha256 hashes; the raw token
-- is returned to the booker exactly once and used for self-service.

CREATE TABLE "bookings" (
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
        FOREIGN KEY ("event_type_id") REFERENCES "event_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "bookings_google_account_id_fkey"
        FOREIGN KEY ("google_account_id") REFERENCES "connected_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Idempotency: replaying a request with the same client_request_id (per event type)
-- returns the existing booking instead of creating a duplicate.
CREATE UNIQUE INDEX "bookings_event_type_id_client_request_id_key"
    ON "bookings"("event_type_id", "client_request_id");
CREATE INDEX "bookings_start_at_end_at_idx" ON "bookings"("start_at", "end_at");
CREATE INDEX "bookings_event_type_id_status_idx" ON "bookings"("event_type_id", "status");
CREATE INDEX "bookings_status_start_at_idx" ON "bookings"("status", "start_at");

CREATE TABLE "booking_history" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "booking_id"   TEXT NOT NULL,
    "action"       TEXT NOT NULL,
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "actor"        TEXT NOT NULL,
    "created_at"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_history_booking_id_fkey"
        FOREIGN KEY ("booking_id") REFERENCES "bookings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "booking_history_booking_id_created_at_idx"
    ON "booking_history"("booking_id", "created_at");
