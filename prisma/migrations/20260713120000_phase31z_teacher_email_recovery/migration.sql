-- Phase 31z: teacher/research email recovery and account-security tokens.

CREATE TYPE "AccountSecurityTokenPurpose" AS ENUM (
  'teacher_password_reset',
  'teacher_email_change_verification'
);

ALTER TABLE "users"
  ADD COLUMN "email_normalized" TEXT,
  ADD COLUMN "email_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "pending_email" TEXT,
  ADD COLUMN "pending_email_normalized" TEXT,
  ADD COLUMN "email_change_requested_at" TIMESTAMPTZ(6);

CREATE INDEX "users_email_normalized_idx" ON "users"("email_normalized");
CREATE INDEX "users_pending_email_normalized_idx" ON "users"("pending_email_normalized");

CREATE UNIQUE INDEX "users_teacher_email_normalized_unique_idx"
  ON "users"("email_normalized")
  WHERE "email_normalized" IS NOT NULL AND "role" = 'teacher_researcher';

CREATE UNIQUE INDEX "users_teacher_pending_email_normalized_unique_idx"
  ON "users"("pending_email_normalized")
  WHERE "pending_email_normalized" IS NOT NULL AND "role" = 'teacher_researcher';

CREATE TABLE "account_security_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "token_public_id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_db_id" UUID NOT NULL,
  "purpose" "AccountSecurityTokenPurpose" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "pending_email_normalized" TEXT,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "invalidated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "request_ip_hash" TEXT,
  "request_user_agent_hash" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "metadata_json" JSONB,

  CONSTRAINT "account_security_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_security_tokens_user_db_id_fkey"
    FOREIGN KEY ("user_db_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "account_security_tokens_token_public_id_key" ON "account_security_tokens"("token_public_id");
CREATE UNIQUE INDEX "account_security_tokens_token_hash_key" ON "account_security_tokens"("token_hash");
CREATE INDEX "account_security_tokens_user_db_id_purpose_expires_at_idx"
  ON "account_security_tokens"("user_db_id", "purpose", "expires_at");
CREATE INDEX "account_security_tokens_purpose_expires_at_idx"
  ON "account_security_tokens"("purpose", "expires_at");
CREATE INDEX "account_security_tokens_pending_email_normalized_idx"
  ON "account_security_tokens"("pending_email_normalized");

CREATE TABLE "account_security_rate_limits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope" TEXT NOT NULL,
  "scope_hash" TEXT NOT NULL,
  "window_start" TIMESTAMPTZ(6) NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "last_request_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "account_security_rate_limits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_security_rate_limits_scope_scope_hash_window_start_key"
  ON "account_security_rate_limits"("scope", "scope_hash", "window_start");
CREATE INDEX "account_security_rate_limits_scope_scope_hash_last_request_at_idx"
  ON "account_security_rate_limits"("scope", "scope_hash", "last_request_at");

CREATE TABLE "account_security_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_public_id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_db_id" UUID,
  "performed_by_user_db_id" UUID,
  "event_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "metadata_json" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "account_security_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_security_events_user_db_id_fkey"
    FOREIGN KEY ("user_db_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "account_security_events_performed_by_user_db_id_fkey"
    FOREIGN KEY ("performed_by_user_db_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "account_security_events_event_public_id_key" ON "account_security_events"("event_public_id");
CREATE INDEX "account_security_events_user_db_id_created_at_idx" ON "account_security_events"("user_db_id", "created_at");
CREATE INDEX "account_security_events_event_type_created_at_idx" ON "account_security_events"("event_type", "created_at");
