-- Phase 7E2A live evaluation canary audit fields.
ALTER TYPE "EvalRunStatus" ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE "EvalRunStatus" ADD VALUE IF NOT EXISTS 'budget_unverifiable';

ALTER TABLE "eval_runs"
  ADD COLUMN "planned_run_item_count" INTEGER,
  ADD COLUMN "provider_request_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "model_snapshot" TEXT,
  ADD COLUMN "reasoning_effort" TEXT,
  ADD COLUMN "case_manifest_hash" TEXT,
  ADD COLUMN "run_config_hash" TEXT,
  ADD COLUMN "reproducibility_manifest" JSONB,
  ADD COLUMN "pricing_registry_version" TEXT,
  ADD COLUMN "budget_limit_usd" DECIMAL(12, 6),
  ADD COLUMN "estimated_cost_usd" DECIMAL(12, 6),
  ADD COLUMN "error_message" TEXT,
  ADD COLUMN "canary_gate_status" TEXT;

ALTER TABLE "eval_run_items"
  ADD COLUMN "run_order" INTEGER,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "model_snapshot" TEXT,
  ADD COLUMN "reasoning_effort" TEXT,
  ADD COLUMN "max_output_tokens" INTEGER,
  ADD COLUMN "provider_response_id" TEXT,
  ADD COLUMN "provider_request_id" TEXT,
  ADD COLUMN "client_request_id" TEXT,
  ADD COLUMN "prompt_version" TEXT,
  ADD COLUMN "schema_version" TEXT,
  ADD COLUMN "prompt_hash" TEXT,
  ADD COLUMN "error_category" TEXT,
  ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "input_tokens" INTEGER,
  ADD COLUMN "cached_input_tokens" INTEGER,
  ADD COLUMN "output_tokens" INTEGER,
  ADD COLUMN "reasoning_tokens" INTEGER,
  ADD COLUMN "total_tokens" INTEGER,
  ADD COLUMN "estimated_cost_usd" DECIMAL(12, 6),
  ADD COLUMN "started_at" TIMESTAMPTZ(6),
  ADD COLUMN "completed_at" TIMESTAMPTZ(6);

CREATE INDEX "eval_runs_model_snapshot_idx" ON "eval_runs"("model_snapshot");
CREATE INDEX "eval_runs_case_manifest_hash_idx" ON "eval_runs"("case_manifest_hash");
CREATE UNIQUE INDEX "eval_run_items_idempotency_key_key" ON "eval_run_items"("idempotency_key");
CREATE INDEX "eval_run_items_run_db_id_run_order_idx" ON "eval_run_items"("run_db_id", "run_order");
CREATE INDEX "eval_run_items_model_snapshot_idx" ON "eval_run_items"("model_snapshot");
CREATE INDEX "eval_run_items_provider_response_id_idx" ON "eval_run_items"("provider_response_id");
