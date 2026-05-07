-- Add week_start column to users table.
-- 0 = Sunday, 1 = Monday (default, common for business scheduling).
ALTER TABLE "users" ADD COLUMN "week_start" INTEGER NOT NULL DEFAULT 1;
