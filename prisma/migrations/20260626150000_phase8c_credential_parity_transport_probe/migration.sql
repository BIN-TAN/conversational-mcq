-- Phase 8C credential parity and verified transport-probe attestation.
-- Stores only non-secret credential fingerprints and sanitized model-access check metadata.
CREATE TABLE "operational_live_canary_credential_checks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "check_public_id" TEXT NOT NULL,
  "credential_fingerprint" TEXT,
  "credential_source" TEXT,
  "resolver_version" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "model_snapshot" TEXT NOT NULL,
  "application_git_commit" TEXT NOT NULL,
  "approved_config_hash" TEXT NOT NULL,
  "manifest_hash" TEXT NOT NULL,
  "adapter_version" TEXT NOT NULL,
  "sdk_version" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "http_status" INTEGER,
  "provider_request_id" TEXT,
  "authentication_verified" BOOLEAN NOT NULL DEFAULT false,
  "model_access_verified" BOOLEAN NOT NULL DEFAULT false,
  "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "sanitized_failure_reason" TEXT,
  CONSTRAINT "operational_live_canary_credential_checks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_live_canary_credential_checks_check_public_id_key"
  ON "operational_live_canary_credential_checks"("check_public_id");
CREATE INDEX "operational_live_canary_credential_checks_fingerprint_status_expiry_idx"
  ON "operational_live_canary_credential_checks"("credential_fingerprint", "status", "expires_at");
CREATE INDEX "operational_live_canary_credential_checks_model_adapter_sdk_idx"
  ON "operational_live_canary_credential_checks"("model_snapshot", "adapter_version", "sdk_version");
CREATE INDEX "operational_live_canary_credential_checks_commit_config_manifest_idx"
  ON "operational_live_canary_credential_checks"("application_git_commit", "approved_config_hash", "manifest_hash");

ALTER TABLE "operational_live_canary_dispatch_attempts"
  ADD COLUMN "credential_fingerprint" TEXT,
  ADD COLUMN "credential_source" TEXT,
  ADD COLUMN "credential_resolver_version" TEXT;

CREATE INDEX "operational_live_canary_dispatch_attempts_credential_fingerprint_idx"
  ON "operational_live_canary_dispatch_attempts"("credential_fingerprint");
