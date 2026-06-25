CREATE TABLE "operational_live_canary_runs" (
    "id" UUID NOT NULL,
    "run_public_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "manifest_version" TEXT NOT NULL,
    "manifest_hash" TEXT NOT NULL,
    "approved_config_hash" TEXT NOT NULL,
    "model_snapshot" TEXT NOT NULL,
    "reasoning_effort" TEXT NOT NULL,
    "planned_logical_invocations" INTEGER NOT NULL,
    "provider_request_count" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "budget_limit_usd" DECIMAL(12,6) NOT NULL,
    "application_git_commit" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "paused_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operational_live_canary_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "operational_live_canary_steps" (
    "id" UUID NOT NULL,
    "step_public_id" TEXT NOT NULL,
    "run_db_id" UUID NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "student_public_id" TEXT,
    "logical_invocation_key" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "execution_status" TEXT NOT NULL,
    "agent_call_public_id" TEXT,
    "effective_result_public_id" TEXT,
    "provider_request_count" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "error_category" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "operational_live_canary_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "operational_live_canary_review_annotations" (
    "id" UUID NOT NULL,
    "annotation_public_id" TEXT NOT NULL,
    "run_db_id" UUID NOT NULL,
    "review_item_id" TEXT NOT NULL,
    "annotation_source" TEXT NOT NULL DEFAULT 'ai_agent_review',
    "annotation_status" TEXT NOT NULL DEFAULT 'ai_confirmed',
    "review_target" TEXT NOT NULL DEFAULT 'operational_effective_output',
    "reviewer_model" TEXT,
    "review_method" TEXT DEFAULT 'blind_review',
    "reviewed_at" TIMESTAMPTZ(6),
    "annotation_file_hash" TEXT,
    "reference_file_hash" TEXT,
    "pass_fail" TEXT,
    "overall_rating" INTEGER,
    "rubric_scores" JSONB,
    "safety_flags" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operational_live_canary_review_annotations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_live_canary_runs_run_public_id_key" ON "operational_live_canary_runs"("run_public_id");
CREATE INDEX "operational_live_canary_runs_status_created_at_idx" ON "operational_live_canary_runs"("status", "created_at");
CREATE INDEX "operational_live_canary_runs_manifest_hash_idx" ON "operational_live_canary_runs"("manifest_hash");

CREATE UNIQUE INDEX "operational_live_canary_steps_step_public_id_key" ON "operational_live_canary_steps"("step_public_id");
CREATE UNIQUE INDEX "operational_live_canary_step_invocation_key" ON "operational_live_canary_steps"("run_db_id", "logical_invocation_key");
CREATE INDEX "operational_live_canary_steps_run_db_id_step_order_idx" ON "operational_live_canary_steps"("run_db_id", "step_order");
CREATE INDEX "operational_live_canary_steps_agent_name_execution_status_idx" ON "operational_live_canary_steps"("agent_name", "execution_status");
CREATE INDEX "operational_live_canary_steps_scenario_id_idx" ON "operational_live_canary_steps"("scenario_id");

CREATE UNIQUE INDEX "operational_live_canary_review_annotations_annotation_public_id_key" ON "operational_live_canary_review_annotations"("annotation_public_id");
CREATE UNIQUE INDEX "operational_live_canary_review_item_target_key" ON "operational_live_canary_review_annotations"("run_db_id", "review_item_id", "review_target");
CREATE INDEX "operational_live_canary_review_annotations_annotation_source_annotation_status_idx" ON "operational_live_canary_review_annotations"("annotation_source", "annotation_status");
CREATE INDEX "operational_live_canary_review_annotations_review_target_idx" ON "operational_live_canary_review_annotations"("review_target");
CREATE INDEX "operational_live_canary_review_annotations_pass_fail_idx" ON "operational_live_canary_review_annotations"("pass_fail");

ALTER TABLE "operational_live_canary_steps" ADD CONSTRAINT "operational_live_canary_steps_run_db_id_fkey" FOREIGN KEY ("run_db_id") REFERENCES "operational_live_canary_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_live_canary_review_annotations" ADD CONSTRAINT "operational_live_canary_review_annotations_run_db_id_fkey" FOREIGN KEY ("run_db_id") REFERENCES "operational_live_canary_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
