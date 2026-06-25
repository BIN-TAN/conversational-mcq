ALTER TABLE "operational_live_canary_dispatch_attempts"
  ADD COLUMN "transport" TEXT,
  ADD COLUMN "adapter_version" TEXT,
  ADD COLUMN "network_dispatch_expected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "network_dispatch_started" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_completed_stage" TEXT,
  ADD COLUMN "failure_stage" TEXT,
  ADD COLUMN "typed_failure_reason" TEXT,
  ADD COLUMN "original_error_class" TEXT,
  ADD COLUMN "stage_trace_json" JSONB,
  ADD COLUMN "transport_objective_json" JSONB;

CREATE INDEX "operational_live_canary_dispatch_attempts_transport_idx"
  ON "operational_live_canary_dispatch_attempts"("transport");

CREATE INDEX "operational_live_canary_dispatch_attempts_failure_stage_idx"
  ON "operational_live_canary_dispatch_attempts"("failure_stage");

CREATE INDEX "operational_live_canary_dispatch_attempts_typed_failure_reason_idx"
  ON "operational_live_canary_dispatch_attempts"("typed_failure_reason");
