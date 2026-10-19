-- One-time invitations: per-invitation private schedules and re-copyable links.
ALTER TABLE "schedules" ADD COLUMN "is_one_time" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "booking_invites" ADD COLUMN "token_enc" TEXT;
