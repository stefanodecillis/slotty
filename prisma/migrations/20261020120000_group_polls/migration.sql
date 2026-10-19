-- Group availability polls for one-time invitations.
CREATE TABLE "group_polls" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_type_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'collecting',
    "show_names" BOOLEAN NOT NULL DEFAULT true,
    "allow_google" BOOLEAN NOT NULL DEFAULT true,
    "finalized_booking_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "group_polls_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "poll_participants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poll_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "edit_token_hash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "google_synced_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "poll_participants_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "group_polls" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "poll_votes" (
    "participant_id" TEXT NOT NULL,
    "slot_start" DATETIME NOT NULL,
    "value" TEXT NOT NULL,

    PRIMARY KEY ("participant_id", "slot_start"),
    CONSTRAINT "poll_votes_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "poll_participants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "group_polls_event_type_id_key" ON "group_polls"("event_type_id");
CREATE UNIQUE INDEX "group_polls_finalized_booking_id_key" ON "group_polls"("finalized_booking_id");
CREATE UNIQUE INDEX "poll_participants_edit_token_hash_key" ON "poll_participants"("edit_token_hash");
CREATE INDEX "poll_participants_poll_id_created_at_idx" ON "poll_participants"("poll_id", "created_at");
CREATE UNIQUE INDEX "poll_participants_poll_id_email_key" ON "poll_participants"("poll_id", "email");
