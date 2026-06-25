-- Phase 8C transport-failure root-cause and accounting ledger fields.
-- Historical rows are preserved; new booleans default to conservative false/unknown values.
ALTER TABLE "operational_live_canary_dispatch_attempts"
  ADD COLUMN "transport_adapter_entered" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "request_serialization_completed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fetch_invoked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "response_headers_received" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "response_body_received" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "network_request_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "provider_acknowledged_request_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "accounting_complete" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "http_status" INTEGER,
  ADD COLUMN "provider_error_code" TEXT,
  ADD COLUMN "provider_error_type" TEXT,
  ADD COLUMN "provider_error_param" TEXT,
  ADD COLUMN "provider_request_header_id" TEXT,
  ADD COLUMN "retry_after_ms" INTEGER,
  ADD COLUMN "normalized_failure_json" JSONB,
  ADD COLUMN "cost_status" TEXT NOT NULL DEFAULT 'unknown';

CREATE INDEX "operational_live_canary_dispatch_attempts_cost_status_idx"
  ON "operational_live_canary_dispatch_attempts"("cost_status");
CREATE INDEX "operational_live_canary_dispatch_attempts_fetch_invoked_idx"
  ON "operational_live_canary_dispatch_attempts"("fetch_invoked");
