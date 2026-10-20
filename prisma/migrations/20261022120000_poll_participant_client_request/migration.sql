-- Retry-safe poll answers: a client (often an AI assistant) may send a
-- clientRequestId with its first answer. A retry with the same id updates
-- that answer instead of adding a second participant. Stored hashed because
-- it also lets the retry edit the answer.
ALTER TABLE "poll_participants" ADD COLUMN "client_request_hash" TEXT;

CREATE UNIQUE INDEX "poll_participants_poll_id_client_request_hash_key" ON "poll_participants"("poll_id", "client_request_hash");
