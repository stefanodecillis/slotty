-- Migration: add_max_guests
-- Caps how many additional guests a booker can invite for a given event type.
-- Existing rows take the default of 3 — matches the previous implicit behavior
-- where the booking endpoint accepted up to 20 guests with no per-event cap.

ALTER TABLE "event_types" ADD COLUMN "max_guests" INTEGER NOT NULL DEFAULT 3;
