-- Migration: phase9_admin_polish
-- Phase 9: Audit logs, webhook endpoints/deliveries, TOTP backup codes,
-- totpEnabled flag on users.

-- Add totpEnabled column to users
ALTER TABLE "users" ADD COLUMN "totp_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Audit log table
CREATE TABLE "audit_logs" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "user_id"       TEXT,
    "actor"         TEXT NOT NULL,
    "action"        TEXT NOT NULL,
    "target_type"   TEXT,
    "target_id"     TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "ip"            TEXT,
    "user_agent"    TEXT,
    "created_at"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- Webhook endpoints table
CREATE TABLE "webhook_endpoints" (
    "id"               TEXT NOT NULL PRIMARY KEY,
    "user_id"          TEXT NOT NULL,
    "url"              TEXT NOT NULL,
    "secret_enc"       TEXT NOT NULL,
    "event_types_json" TEXT NOT NULL,
    "active"           BOOLEAN NOT NULL DEFAULT true,
    "created_at"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       DATETIME NOT NULL,
    CONSTRAINT "webhook_endpoints_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "webhook_endpoints_user_id_active_idx" ON "webhook_endpoints"("user_id", "active");

-- Webhook deliveries table
CREATE TABLE "webhook_deliveries" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "endpoint_id"   TEXT NOT NULL,
    "event"         TEXT NOT NULL,
    "payload_json"  TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'pending',
    "attempts"      INTEGER NOT NULL DEFAULT 0,
    "last_error"    TEXT,
    "response_code" INTEGER,
    "next_retry_at" DATETIME,
    "delivered_at"  DATETIME,
    "created_at"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_deliveries_endpoint_id_fkey"
        FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries"("status", "next_retry_at");
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries"("endpoint_id", "created_at");

-- Backup codes table
CREATE TABLE "backup_codes" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "user_id"    TEXT NOT NULL,
    "code_hash"  TEXT NOT NULL,
    "used_at"    DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_codes_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "backup_codes_user_id_used_at_idx" ON "backup_codes"("user_id", "used_at");
