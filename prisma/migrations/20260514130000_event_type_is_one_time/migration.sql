-- Migration: event_type_is_one_time
-- Adds an explicit `is_one_time` flag on event_types so the admin UI can
-- cleanly separate one-time-link EventTypes (created via the "New one-time
-- link" flow, single-use invite, pruned after retention window) from normal
-- bookable event types — without relying on slug-prefix detection.
--
-- Backfill: any EventType from the earlier ship that has the one-time
-- fingerprint (hidden + invite_only + slug starts with "ot-") is migrated
-- to is_one_time=1 so the screenshot rows move into the new section on
-- first page load.

ALTER TABLE "event_types" ADD COLUMN "is_one_time" BOOLEAN NOT NULL DEFAULT false;

UPDATE "event_types"
  SET "is_one_time" = 1
  WHERE "invite_only" = 1 AND "hidden" = 1 AND "slug" LIKE 'ot-%';

CREATE INDEX "event_types_user_id_is_one_time_archived_idx"
  ON "event_types"("user_id", "is_one_time", "archived");
