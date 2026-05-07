-- Migration: add_event_types
-- Phase 5: EventType and EventTypeQuestion tables

CREATE TABLE "event_types" (
    "id"                     TEXT NOT NULL PRIMARY KEY,
    "user_id"                TEXT NOT NULL,
    "title"                  TEXT NOT NULL,
    "slug"                   TEXT NOT NULL,
    "description_md"         TEXT,
    "color"                  TEXT NOT NULL DEFAULT '#4F6CFF',
    "hidden"                 BOOLEAN NOT NULL DEFAULT false,
    "duration_minutes"       INTEGER NOT NULL,
    "destination_account_id" TEXT NOT NULL,
    "destination_calendar_id" TEXT NOT NULL,
    "location_kind"          TEXT NOT NULL,
    "location_value"         TEXT,
    "buffer_before_min"      INTEGER NOT NULL DEFAULT 0,
    "buffer_after_min"       INTEGER NOT NULL DEFAULT 0,
    "min_notice_min"         INTEGER NOT NULL DEFAULT 60,
    "booking_window_days"    INTEGER NOT NULL DEFAULT 60,
    "max_per_day"            INTEGER,
    "max_per_week"           INTEGER,
    "slot_interval_min"      INTEGER NOT NULL DEFAULT 15,
    "schedule_id"            TEXT,
    "password_hash"          TEXT,
    "confirmation_md"        TEXT,
    "redirect_url"           TEXT,
    "send_reminders"         BOOLEAN NOT NULL DEFAULT true,
    "position"               INTEGER NOT NULL DEFAULT 0,
    "archived"               BOOLEAN NOT NULL DEFAULT false,
    "created_at"             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             DATETIME NOT NULL,
    CONSTRAINT "event_types_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "event_types_destination_account_id_fkey"
        FOREIGN KEY ("destination_account_id") REFERENCES "connected_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "event_types_destination_calendar_id_fkey"
        FOREIGN KEY ("destination_calendar_id") REFERENCES "calendars" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "event_types_schedule_id_fkey"
        FOREIGN KEY ("schedule_id") REFERENCES "schedules" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "event_types_slug_key" ON "event_types"("slug");
CREATE INDEX "event_types_user_id_archived_hidden_idx" ON "event_types"("user_id", "archived", "hidden");
CREATE INDEX "event_types_slug_idx" ON "event_types"("slug");

CREATE TABLE "event_type_questions" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "event_type_id" TEXT NOT NULL,
    "label"         TEXT NOT NULL,
    "helper_text"   TEXT,
    "kind"          TEXT NOT NULL,
    "required"      BOOLEAN NOT NULL DEFAULT false,
    "options_json"  TEXT,
    "position"      INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "event_type_questions_event_type_id_fkey"
        FOREIGN KEY ("event_type_id") REFERENCES "event_types" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "event_type_questions_event_type_id_position_idx" ON "event_type_questions"("event_type_id", "position");
