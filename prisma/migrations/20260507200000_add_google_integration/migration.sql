-- Phase 3: Google Calendar integration

-- CreateTable
CREATE TABLE "connected_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "google_user_email" TEXT NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_synced_at" DATETIME,
    "last_sync_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "calendars" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connected_account_id" TEXT NOT NULL,
    "google_calendar_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "timezone" TEXT,
    "background_color" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_busy_source" BOOLEAN NOT NULL DEFAULT true,
    "is_destination_eligible" BOOLEAN NOT NULL DEFAULT false,
    "sync_token" TEXT,
    "watch_channel_id" TEXT,
    "watch_resource_id" TEXT,
    "watch_expires_at" DATETIME,
    "last_incremental_sync_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "calendars_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "connected_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "busy_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calendar_id" TEXT NOT NULL,
    "google_event_id" TEXT NOT NULL,
    "start_at" DATETIME NOT NULL,
    "end_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "is_all_day" BOOLEAN NOT NULL DEFAULT false,
    "transparency" TEXT NOT NULL DEFAULT 'opaque',
    "recurring_event_id" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "busy_events_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "calendars" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "connected_accounts_provider_google_user_email_key" ON "connected_accounts"("provider", "google_user_email");

-- CreateIndex
CREATE UNIQUE INDEX "calendars_connected_account_id_google_calendar_id_key" ON "calendars"("connected_account_id", "google_calendar_id");

-- CreateIndex
CREATE INDEX "busy_events_start_at_end_at_idx" ON "busy_events"("start_at", "end_at");

-- CreateIndex
CREATE INDEX "busy_events_calendar_id_start_at_idx" ON "busy_events"("calendar_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "busy_events_calendar_id_google_event_id_key" ON "busy_events"("calendar_id", "google_event_id");
