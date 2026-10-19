-- Emails are no longer unique per poll: refusing a taken address told anyone
-- with the poll link who had answered, even when names were hidden.
DROP INDEX "poll_participants_poll_id_email_key";
