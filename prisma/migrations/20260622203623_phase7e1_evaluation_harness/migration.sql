-- CreateEnum
CREATE TYPE "EvalCaseSource" AS ENUM ('synthetic', 'teacher_authored', 'deidentified');

-- CreateEnum
CREATE TYPE "EvalRunMode" AS ENUM ('mock', 'imported_output', 'live_provider');

-- CreateEnum
CREATE TYPE "EvalRecordStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "EvalRunStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "eval_suites" (
    "id" UUID NOT NULL,
    "suite_public_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "agent_name" TEXT NOT NULL,
    "status" "EvalRecordStatus" NOT NULL DEFAULT 'active',
    "created_by_user_db_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "eval_suites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_cases" (
    "id" UUID NOT NULL,
    "case_public_id" TEXT NOT NULL,
    "suite_db_id" UUID NOT NULL,
    "case_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "input_payload" JSONB NOT NULL,
    "expected_output" JSONB,
    "gold_labels" JSONB,
    "rubric_expectations" JSONB,
    "safety_expectations" JSONB,
    "case_source" "EvalCaseSource" NOT NULL,
    "status" "EvalRecordStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "eval_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_runs" (
    "id" UUID NOT NULL,
    "run_public_id" TEXT NOT NULL,
    "suite_db_id" UUID NOT NULL,
    "agent_name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_config" JSONB,
    "prompt_version" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "run_mode" "EvalRunMode" NOT NULL,
    "repetition_count" INTEGER NOT NULL DEFAULT 1,
    "status" "EvalRunStatus" NOT NULL DEFAULT 'pending',
    "created_by_user_db_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_run_items" (
    "id" UUID NOT NULL,
    "run_item_public_id" TEXT NOT NULL,
    "run_db_id" UUID NOT NULL,
    "case_db_id" UUID NOT NULL,
    "repetition_index" INTEGER NOT NULL,
    "input_payload" JSONB NOT NULL,
    "raw_output" JSONB,
    "parsed_output" JSONB,
    "output_validated" BOOLEAN NOT NULL DEFAULT false,
    "schema_validation_error" TEXT,
    "semantic_validation_result" JSONB,
    "safety_validation_result" JSONB,
    "execution_status" TEXT NOT NULL,
    "latency_ms" INTEGER,
    "token_usage" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "eval_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_annotations" (
    "id" UUID NOT NULL,
    "annotation_public_id" TEXT NOT NULL,
    "run_item_db_id" UUID NOT NULL,
    "annotated_by_user_db_id" UUID NOT NULL,
    "blind_review" BOOLEAN NOT NULL DEFAULT true,
    "overall_rating" INTEGER,
    "pass_fail" TEXT,
    "rubric_scores" JSONB,
    "safety_flags" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "eval_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_rubrics" (
    "id" UUID NOT NULL,
    "rubric_public_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "rubric_version" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "eval_rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "eval_suites_suite_public_id_key" ON "eval_suites"("suite_public_id");

-- CreateIndex
CREATE INDEX "eval_suites_agent_name_status_idx" ON "eval_suites"("agent_name", "status");

-- CreateIndex
CREATE INDEX "eval_suites_created_by_user_db_id_idx" ON "eval_suites"("created_by_user_db_id");

-- CreateIndex
CREATE UNIQUE INDEX "eval_suites_agent_name_title_key" ON "eval_suites"("agent_name", "title");

-- CreateIndex
CREATE UNIQUE INDEX "eval_cases_case_public_id_key" ON "eval_cases"("case_public_id");

-- CreateIndex
CREATE INDEX "eval_cases_agent_name_status_idx" ON "eval_cases"("agent_name", "status");

-- CreateIndex
CREATE INDEX "eval_cases_case_source_idx" ON "eval_cases"("case_source");

-- CreateIndex
CREATE UNIQUE INDEX "eval_cases_suite_db_id_case_id_key" ON "eval_cases"("suite_db_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "eval_runs_run_public_id_key" ON "eval_runs"("run_public_id");

-- CreateIndex
CREATE INDEX "eval_runs_suite_db_id_created_at_idx" ON "eval_runs"("suite_db_id", "created_at");

-- CreateIndex
CREATE INDEX "eval_runs_agent_name_status_idx" ON "eval_runs"("agent_name", "status");

-- CreateIndex
CREATE INDEX "eval_runs_run_mode_status_idx" ON "eval_runs"("run_mode", "status");

-- CreateIndex
CREATE INDEX "eval_runs_created_by_user_db_id_idx" ON "eval_runs"("created_by_user_db_id");

-- CreateIndex
CREATE UNIQUE INDEX "eval_run_items_run_item_public_id_key" ON "eval_run_items"("run_item_public_id");

-- CreateIndex
CREATE INDEX "eval_run_items_run_db_id_created_at_idx" ON "eval_run_items"("run_db_id", "created_at");

-- CreateIndex
CREATE INDEX "eval_run_items_case_db_id_idx" ON "eval_run_items"("case_db_id");

-- CreateIndex
CREATE INDEX "eval_run_items_execution_status_idx" ON "eval_run_items"("execution_status");

-- CreateIndex
CREATE INDEX "eval_run_items_output_validated_idx" ON "eval_run_items"("output_validated");

-- CreateIndex
CREATE UNIQUE INDEX "eval_run_items_run_db_id_case_db_id_repetition_index_key" ON "eval_run_items"("run_db_id", "case_db_id", "repetition_index");

-- CreateIndex
CREATE UNIQUE INDEX "eval_annotations_annotation_public_id_key" ON "eval_annotations"("annotation_public_id");

-- CreateIndex
CREATE INDEX "eval_annotations_annotated_by_user_db_id_created_at_idx" ON "eval_annotations"("annotated_by_user_db_id", "created_at");

-- CreateIndex
CREATE INDEX "eval_annotations_pass_fail_idx" ON "eval_annotations"("pass_fail");

-- CreateIndex
CREATE UNIQUE INDEX "eval_annotations_run_item_db_id_annotated_by_user_db_id_key" ON "eval_annotations"("run_item_db_id", "annotated_by_user_db_id");

-- CreateIndex
CREATE UNIQUE INDEX "eval_rubrics_rubric_public_id_key" ON "eval_rubrics"("rubric_public_id");

-- CreateIndex
CREATE INDEX "eval_rubrics_agent_name_idx" ON "eval_rubrics"("agent_name");

-- CreateIndex
CREATE UNIQUE INDEX "eval_rubrics_agent_name_rubric_version_key" ON "eval_rubrics"("agent_name", "rubric_version");

-- AddForeignKey
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_created_by_user_db_id_fkey" FOREIGN KEY ("created_by_user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_suite_db_id_fkey" FOREIGN KEY ("suite_db_id") REFERENCES "eval_suites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_suite_db_id_fkey" FOREIGN KEY ("suite_db_id") REFERENCES "eval_suites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_created_by_user_db_id_fkey" FOREIGN KEY ("created_by_user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_run_items" ADD CONSTRAINT "eval_run_items_run_db_id_fkey" FOREIGN KEY ("run_db_id") REFERENCES "eval_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_run_items" ADD CONSTRAINT "eval_run_items_case_db_id_fkey" FOREIGN KEY ("case_db_id") REFERENCES "eval_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_annotations" ADD CONSTRAINT "eval_annotations_run_item_db_id_fkey" FOREIGN KEY ("run_item_db_id") REFERENCES "eval_run_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_annotations" ADD CONSTRAINT "eval_annotations_annotated_by_user_db_id_fkey" FOREIGN KEY ("annotated_by_user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
