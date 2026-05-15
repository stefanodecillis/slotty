-- AlterTable
ALTER TABLE "users" ADD COLUMN "default_brand_id" TEXT;

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primary_color" TEXT NOT NULL DEFAULT '#4F6CFF',
    "accent_color" TEXT NOT NULL DEFAULT '#4F6CFF',
    "logo_path" TEXT,
    "favicon_path" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "brands_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_event_types" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description_md" TEXT,
    "color" TEXT NOT NULL DEFAULT '#4F6CFF',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "duration_minutes" INTEGER NOT NULL,
    "destination_account_id" TEXT NOT NULL,
    "destination_calendar_id" TEXT NOT NULL,
    "location_kind" TEXT NOT NULL,
    "location_value" TEXT,
    "buffer_before_min" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_min" INTEGER NOT NULL DEFAULT 0,
    "min_notice_min" INTEGER NOT NULL DEFAULT 60,
    "booking_window_days" INTEGER NOT NULL DEFAULT 60,
    "max_per_day" INTEGER,
    "max_per_week" INTEGER,
    "max_guests" INTEGER NOT NULL DEFAULT 3,
    "slot_interval_min" INTEGER NOT NULL DEFAULT 15,
    "schedule_id" TEXT,
    "password_hash" TEXT,
    "confirmation_md" TEXT,
    "redirect_url" TEXT,
    "send_reminders" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "invite_only" BOOLEAN NOT NULL DEFAULT false,
    "is_one_time" BOOLEAN NOT NULL DEFAULT false,
    "hidden_guests_json" TEXT NOT NULL DEFAULT '[]',
    "brand_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "event_types_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "event_types_destination_account_id_fkey" FOREIGN KEY ("destination_account_id") REFERENCES "connected_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "event_types_destination_calendar_id_fkey" FOREIGN KEY ("destination_calendar_id") REFERENCES "calendars" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "event_types_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "event_types_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_event_types" ("archived", "booking_window_days", "buffer_after_min", "buffer_before_min", "color", "confirmation_md", "created_at", "description_md", "destination_account_id", "destination_calendar_id", "duration_minutes", "hidden", "hidden_guests_json", "id", "invite_only", "is_one_time", "location_kind", "location_value", "max_guests", "max_per_day", "max_per_week", "min_notice_min", "password_hash", "position", "redirect_url", "schedule_id", "send_reminders", "slot_interval_min", "slug", "title", "updated_at", "user_id") SELECT "archived", "booking_window_days", "buffer_after_min", "buffer_before_min", "color", "confirmation_md", "created_at", "description_md", "destination_account_id", "destination_calendar_id", "duration_minutes", "hidden", "hidden_guests_json", "id", "invite_only", "is_one_time", "location_kind", "location_value", "max_guests", "max_per_day", "max_per_week", "min_notice_min", "password_hash", "position", "redirect_url", "schedule_id", "send_reminders", "slot_interval_min", "slug", "title", "updated_at", "user_id" FROM "event_types";
DROP TABLE "event_types";
ALTER TABLE "new_event_types" RENAME TO "event_types";
CREATE UNIQUE INDEX "event_types_slug_key" ON "event_types"("slug");
CREATE INDEX "event_types_user_id_archived_hidden_idx" ON "event_types"("user_id", "archived", "hidden");
CREATE INDEX "event_types_user_id_is_one_time_archived_idx" ON "event_types"("user_id", "is_one_time", "archived");
CREATE INDEX "event_types_slug_idx" ON "event_types"("slug");
CREATE INDEX "event_types_brand_id_idx" ON "event_types"("brand_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "brands_user_id_idx" ON "brands"("user_id");
