-- Migration: add_timezone_set
-- Adds a flag that records whether the owner's timezone has been explicitly
-- set (either by autodetect on first admin visit, or manually in settings).
-- Existing rows default to false so the next admin visit triggers detection.

ALTER TABLE "users" ADD COLUMN "timezone_set" BOOLEAN NOT NULL DEFAULT false;
