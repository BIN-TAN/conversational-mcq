-- Phase 7E2B full live evaluation pilot metadata.
-- Optional columns preserve historical eval runs and run items unchanged.
ALTER TABLE "eval_runs"
  ADD COLUMN "evaluation_phase" TEXT,
  ADD COLUMN "approved_canary_run_public_id" TEXT,
  ADD COLUMN "pilot_manifest_version" TEXT,
  ADD COLUMN "pilot_manifest_hash" TEXT,
  ADD COLUMN "agent_configuration_hash" TEXT,
  ADD COLUMN "ordering_algorithm_version" TEXT;

ALTER TABLE "eval_run_items"
  ADD COLUMN "evaluation_phase" TEXT,
  ADD COLUMN "evaluation_stratum" TEXT,
  ADD COLUMN "paired_case_key" TEXT,
  ADD COLUMN "case_hash" TEXT;

CREATE INDEX "eval_runs_evaluation_phase_status_idx" ON "eval_runs"("evaluation_phase", "status");
CREATE INDEX "eval_runs_approved_canary_run_public_id_idx" ON "eval_runs"("approved_canary_run_public_id");
CREATE INDEX "eval_runs_pilot_manifest_hash_idx" ON "eval_runs"("pilot_manifest_hash");
CREATE INDEX "eval_runs_agent_configuration_hash_idx" ON "eval_runs"("agent_configuration_hash");
CREATE INDEX "eval_run_items_run_db_id_evaluation_stratum_idx" ON "eval_run_items"("run_db_id", "evaluation_stratum");
CREATE INDEX "eval_run_items_run_db_id_paired_case_key_idx" ON "eval_run_items"("run_db_id", "paired_case_key");
CREATE INDEX "eval_run_items_evaluation_phase_idx" ON "eval_run_items"("evaluation_phase");
