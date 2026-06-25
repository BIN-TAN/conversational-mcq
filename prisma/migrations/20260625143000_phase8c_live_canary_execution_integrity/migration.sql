-- Phase 8C execution-integrity hardening for operational guarded-live canaries.
-- Additive only: preserves historical run, step, annotation, and provider audit rows.

ALTER TABLE "operational_live_canary_runs"
  ADD COLUMN "runner_instance_id" TEXT,
  ADD COLUMN "claimed_at" TIMESTAMPTZ(6),
  ADD COLUMN "heartbeat_at" TIMESTAMPTZ(6),
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "interruption_detected_at" TIMESTAMPTZ(6),
  ADD COLUMN "recovery_status" TEXT,
  ADD COLUMN "execution_lifecycle_version" TEXT NOT NULL DEFAULT 'phase8c-execution-integrity-v1';

ALTER TABLE "operational_live_canary_steps"
  ADD COLUMN "runner_instance_id" TEXT,
  ADD COLUMN "claimed_at" TIMESTAMPTZ(6),
  ADD COLUMN "heartbeat_at" TIMESTAMPTZ(6),
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "interruption_detected_at" TIMESTAMPTZ(6),
  ADD COLUMN "recovery_status" TEXT,
  ADD COLUMN "execution_path" TEXT,
  ADD COLUMN "provider_conclusion" TEXT,
  ADD COLUMN "effective_conclusion" TEXT,
  ADD COLUMN "dependency_hash" TEXT;

CREATE TABLE "operational_live_canary_dispatch_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dispatch_public_id" TEXT NOT NULL,
  "run_db_id" UUID NOT NULL,
  "step_db_id" UUID NOT NULL,
  "agent_call_db_id" UUID,
  "logical_invocation_key" TEXT NOT NULL,
  "attempt_index" INTEGER NOT NULL,
  "dispatch_key" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model_snapshot" TEXT NOT NULL,
  "reasoning_effort" TEXT NOT NULL,
  "execution_path" TEXT NOT NULL,
  "provenance_type" TEXT NOT NULL,
  "lifecycle_status" TEXT NOT NULL,
  "request_reserved_at" TIMESTAMPTZ(6),
  "dispatch_started_at" TIMESTAMPTZ(6),
  "response_received_at" TIMESTAMPTZ(6),
  "usage_verified_at" TIMESTAMPTZ(6),
  "finalized_at" TIMESTAMPTZ(6),
  "provider_request_id" TEXT,
  "provider_response_id" TEXT,
  "client_dispatch_id" TEXT NOT NULL,
  "raw_response_hash" TEXT,
  "input_tokens" INTEGER,
  "cached_input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "reasoning_tokens" INTEGER,
  "total_tokens" INTEGER,
  "pricing_registry_version" TEXT,
  "estimated_cost_usd" DECIMAL(12,6),
  "usage_status" TEXT NOT NULL,
  "error_category" TEXT,
  "sanitized_error_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "operational_live_canary_dispatch_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_live_canary_dispatch_attempts_dispatch_public_id_key"
  ON "operational_live_canary_dispatch_attempts"("dispatch_public_id");
CREATE UNIQUE INDEX "operational_live_canary_dispatch_attempts_dispatch_key_key"
  ON "operational_live_canary_dispatch_attempts"("dispatch_key");
CREATE UNIQUE INDEX "operational_live_canary_dispatch_attempts_client_dispatch_id_key"
  ON "operational_live_canary_dispatch_attempts"("client_dispatch_id");
CREATE UNIQUE INDEX "operational_live_canary_dispatch_attempt_order"
  ON "operational_live_canary_dispatch_attempts"("run_db_id", "step_db_id", "attempt_index");
CREATE INDEX "operational_live_canary_dispatch_attempts_run_db_id_created_at_idx"
  ON "operational_live_canary_dispatch_attempts"("run_db_id", "created_at");
CREATE INDEX "operational_live_canary_dispatch_attempts_step_db_id_attempt_index_idx"
  ON "operational_live_canary_dispatch_attempts"("step_db_id", "attempt_index");
CREATE INDEX "operational_live_canary_dispatch_attempts_agent_call_db_id_idx"
  ON "operational_live_canary_dispatch_attempts"("agent_call_db_id");
CREATE INDEX "operational_live_canary_dispatch_attempts_provenance_type_idx"
  ON "operational_live_canary_dispatch_attempts"("provenance_type");
CREATE INDEX "operational_live_canary_dispatch_attempts_lifecycle_status_idx"
  ON "operational_live_canary_dispatch_attempts"("lifecycle_status");
CREATE INDEX "operational_live_canary_dispatch_attempts_usage_status_idx"
  ON "operational_live_canary_dispatch_attempts"("usage_status");

CREATE INDEX "operational_live_canary_runs_runner_instance_id_idx"
  ON "operational_live_canary_runs"("runner_instance_id");
CREATE INDEX "operational_live_canary_runs_lease_expires_at_idx"
  ON "operational_live_canary_runs"("lease_expires_at");
CREATE INDEX "operational_live_canary_steps_runner_instance_id_idx"
  ON "operational_live_canary_steps"("runner_instance_id");
CREATE INDEX "operational_live_canary_steps_lease_expires_at_idx"
  ON "operational_live_canary_steps"("lease_expires_at");
CREATE INDEX "operational_live_canary_steps_provider_conclusion_idx"
  ON "operational_live_canary_steps"("provider_conclusion");
CREATE INDEX "operational_live_canary_steps_effective_conclusion_idx"
  ON "operational_live_canary_steps"("effective_conclusion");

ALTER TABLE "operational_live_canary_dispatch_attempts"
  ADD CONSTRAINT "operational_live_canary_dispatch_attempts_run_db_id_fkey"
  FOREIGN KEY ("run_db_id") REFERENCES "operational_live_canary_runs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "operational_live_canary_dispatch_attempts"
  ADD CONSTRAINT "operational_live_canary_dispatch_attempts_step_db_id_fkey"
  FOREIGN KEY ("step_db_id") REFERENCES "operational_live_canary_steps"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "operational_live_canary_dispatch_attempts"
  ADD CONSTRAINT "operational_live_canary_dispatch_attempts_agent_call_db_id_fkey"
  FOREIGN KEY ("agent_call_db_id") REFERENCES "agent_calls"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
