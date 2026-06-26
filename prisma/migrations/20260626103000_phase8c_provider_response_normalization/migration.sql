-- Phase 8C provider-response normalization and outcome separation.
-- Historical rows are preserved; nullable fields document new success-path evidence for future runs.
ALTER TABLE "operational_live_canary_dispatch_attempts"
  ADD COLUMN "sanitized_response_metadata_json" JSONB,
  ADD COLUMN "usage_source_paths_json" JSONB,
  ADD COLUMN "response_status" TEXT,
  ADD COLUMN "response_status_details_json" JSONB,
  ADD COLUMN "transport_outcome" TEXT,
  ADD COLUMN "raw_output_outcome" TEXT,
  ADD COLUMN "effective_system_outcome" TEXT,
  ADD COLUMN "fallback_reason" TEXT;

CREATE INDEX "operational_live_canary_dispatch_attempts_transport_outcome_idx"
  ON "operational_live_canary_dispatch_attempts"("transport_outcome");
CREATE INDEX "operational_live_canary_dispatch_attempts_raw_output_outcome_idx"
  ON "operational_live_canary_dispatch_attempts"("raw_output_outcome");
CREATE INDEX "operational_live_canary_dispatch_attempts_effective_system_outcome_idx"
  ON "operational_live_canary_dispatch_attempts"("effective_system_outcome");
CREATE INDEX "operational_live_canary_dispatch_attempts_fallback_reason_idx"
  ON "operational_live_canary_dispatch_attempts"("fallback_reason");
