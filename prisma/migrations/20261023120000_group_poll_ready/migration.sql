-- "Tell me when everyone has answered": optional expected participants, an
-- optional answer-by deadline, optional auto-booking, and when the poll
-- became ready.
ALTER TABLE "group_polls" ADD COLUMN "expected_json" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "group_polls" ADD COLUMN "answer_by" DATETIME;
ALTER TABLE "group_polls" ADD COLUMN "auto_book" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "group_polls" ADD COLUMN "ready_at" DATETIME;
