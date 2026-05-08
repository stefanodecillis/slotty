-- Migration: add_site_settings
-- Single-row-per-key store for runtime-editable settings that override the
-- equivalent SLOTTY_* env vars. Used today only for `publicUrl` (the URL
-- baked into invite + manage links). Env stays the source of truth for
-- load-bearing config (OAuth redirect URIs, webhook channel addresses,
-- cookie security flags) — see src/lib/site-url/store.ts.

CREATE TABLE "site_settings" (
    "key"        TEXT NOT NULL PRIMARY KEY,
    "value"      TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL
);
