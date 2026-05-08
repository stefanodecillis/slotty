-- Migration: add_booking_invites
-- One-time, single-use links to a (typically hidden) event type.
-- The raw token is shown to the admin exactly once at generation; only its
-- sha256 hash is stored. Atomic claim happens inside the booking transaction
-- (UPDATE booking_invites SET used_at = ?, used_by_booking_id = ?
--    WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL).
-- The unique index on used_by_booking_id is a defense-in-depth backstop.
--
-- The companion `event_types.invite_only` flag, when set, hides the event
-- type from all slug-keyed public routes — the only way in is /i/<token>.

ALTER TABLE "event_types" ADD COLUMN "invite_only" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "booking_invites" (
    "id"                  TEXT NOT NULL PRIMARY KEY,
    "event_type_id"       TEXT NOT NULL,
    "token_hash"          TEXT NOT NULL,
    "note"                TEXT,
    "expires_at"          DATETIME,
    "used_at"             DATETIME,
    "used_by_booking_id"  TEXT,
    "revoked_at"          DATETIME,
    "created_at"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_invites_event_type_id_fkey"
        FOREIGN KEY ("event_type_id") REFERENCES "event_types" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "booking_invites_used_by_booking_id_fkey"
        FOREIGN KEY ("used_by_booking_id") REFERENCES "bookings" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "booking_invites_token_hash_key"
    ON "booking_invites"("token_hash");
CREATE UNIQUE INDEX "booking_invites_used_by_booking_id_key"
    ON "booking_invites"("used_by_booking_id");
CREATE INDEX "booking_invites_event_type_id_used_at_idx"
    ON "booking_invites"("event_type_id", "used_at");
CREATE INDEX "booking_invites_event_type_id_revoked_at_idx"
    ON "booking_invites"("event_type_id", "revoked_at");
