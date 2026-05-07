-- Phase 4: Availability — Schedule, ScheduleRule, DateOverride

-- CreateTable: schedules
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: schedule_rules
CREATE TABLE "schedule_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schedule_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    CONSTRAINT "schedule_rules_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: date_overrides
CREATE TABLE "date_overrides" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schedule_id" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "label" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "date_overrides_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "schedules_user_id_idx" ON "schedules"("user_id");

-- CreateIndex
CREATE INDEX "schedule_rules_schedule_id_weekday_idx" ON "schedule_rules"("schedule_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "date_overrides_schedule_id_date_key" ON "date_overrides"("schedule_id", "date");

-- CreateIndex
CREATE INDEX "date_overrides_schedule_id_date_idx" ON "date_overrides"("schedule_id", "date");
