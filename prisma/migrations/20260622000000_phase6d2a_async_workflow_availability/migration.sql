-- Phase 6D2A: assessment availability, workflow-mode snapshots, and DB-backed async workflow jobs.
-- Existing assessment/session records remain manual_review for compatibility.

-- CreateEnum
CREATE TYPE "AssessmentWorkflowMode" AS ENUM ('manual_review', 'automatic');

-- CreateEnum
CREATE TYPE "WorkflowJobType" AS ENUM ('run_initial_profiling', 'run_initial_planning', 'start_initial_followup');

-- CreateEnum
CREATE TYPE "WorkflowJobStatus" AS ENUM ('pending', 'running', 'retryable', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "WorkflowOverrideActionType" AS ENUM ('pause_automation', 'resume_automation', 'retry_current_step', 'stop_followup');

-- AlterTable
ALTER TABLE "assessments"
  ADD COLUMN "workflow_mode" "AssessmentWorkflowMode",
  ADD COLUMN "release_at" TIMESTAMPTZ(6),
  ADD COLUMN "close_at" TIMESTAMPTZ(6);

UPDATE "assessments"
SET "workflow_mode" = 'manual_review'
WHERE "workflow_mode" IS NULL;

ALTER TABLE "assessments"
  ALTER COLUMN "workflow_mode" SET NOT NULL,
  ALTER COLUMN "workflow_mode" SET DEFAULT 'automatic';

ALTER TABLE "assessments"
  ADD CONSTRAINT "assessments_valid_availability_window"
  CHECK ("release_at" IS NULL OR "close_at" IS NULL OR "close_at" > "release_at");

-- AlterTable
ALTER TABLE "assessment_sessions"
  ADD COLUMN "workflow_mode_snapshot" "AssessmentWorkflowMode",
  ADD COLUMN "automation_paused_at" TIMESTAMPTZ(6),
  ADD COLUMN "automation_exception_reason" TEXT;

UPDATE "assessment_sessions"
SET "workflow_mode_snapshot" = 'manual_review'
WHERE "workflow_mode_snapshot" IS NULL;

ALTER TABLE "assessment_sessions"
  ALTER COLUMN "workflow_mode_snapshot" SET NOT NULL,
  ALTER COLUMN "workflow_mode_snapshot" SET DEFAULT 'manual_review';

-- CreateTable
CREATE TABLE "workflow_jobs" (
  "id" UUID NOT NULL,
  "job_public_id" TEXT NOT NULL,
  "job_type" "WorkflowJobType" NOT NULL,
  "status" "WorkflowJobStatus" NOT NULL DEFAULT 'pending',
  "assessment_session_db_id" UUID NOT NULL,
  "concept_unit_session_db_id" UUID,
  "idempotency_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "run_after" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "locked_by" TEXT,
  "last_error_category" TEXT,
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "completed_at" TIMESTAMPTZ(6),

  CONSTRAINT "workflow_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_overrides" (
  "id" UUID NOT NULL,
  "override_public_id" TEXT NOT NULL,
  "assessment_session_db_id" UUID NOT NULL,
  "concept_unit_session_db_id" UUID,
  "action_type" "WorkflowOverrideActionType" NOT NULL,
  "reason" TEXT,
  "created_by_user_db_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_jobs_job_public_id_key" ON "workflow_jobs"("job_public_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_jobs_idempotency_key_key" ON "workflow_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "workflow_jobs_status_run_after_created_at_idx" ON "workflow_jobs"("status", "run_after", "created_at");

-- CreateIndex
CREATE INDEX "workflow_jobs_assessment_session_db_id_status_idx" ON "workflow_jobs"("assessment_session_db_id", "status");

-- CreateIndex
CREATE INDEX "workflow_jobs_concept_unit_session_db_id_status_idx" ON "workflow_jobs"("concept_unit_session_db_id", "status");

-- CreateIndex
CREATE INDEX "workflow_jobs_locked_at_idx" ON "workflow_jobs"("locked_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_overrides_override_public_id_key" ON "workflow_overrides"("override_public_id");

-- CreateIndex
CREATE INDEX "workflow_overrides_assessment_session_db_id_created_at_idx" ON "workflow_overrides"("assessment_session_db_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_overrides_concept_unit_session_db_id_created_at_idx" ON "workflow_overrides"("concept_unit_session_db_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_overrides_action_type_created_at_idx" ON "workflow_overrides"("action_type", "created_at");

-- CreateIndex
CREATE INDEX "assessments_workflow_mode_idx" ON "assessments"("workflow_mode");

-- CreateIndex
CREATE INDEX "assessments_release_at_idx" ON "assessments"("release_at");

-- CreateIndex
CREATE INDEX "assessments_close_at_idx" ON "assessments"("close_at");

-- CreateIndex
CREATE INDEX "assessment_sessions_workflow_mode_snapshot_current_phase_idx" ON "assessment_sessions"("workflow_mode_snapshot", "current_phase");

-- AddForeignKey
ALTER TABLE "workflow_jobs"
  ADD CONSTRAINT "workflow_jobs_assessment_session_db_id_fkey"
  FOREIGN KEY ("assessment_session_db_id") REFERENCES "assessment_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_jobs"
  ADD CONSTRAINT "workflow_jobs_concept_unit_session_db_id_fkey"
  FOREIGN KEY ("concept_unit_session_db_id") REFERENCES "concept_unit_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_overrides"
  ADD CONSTRAINT "workflow_overrides_assessment_session_db_id_fkey"
  FOREIGN KEY ("assessment_session_db_id") REFERENCES "assessment_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_overrides"
  ADD CONSTRAINT "workflow_overrides_concept_unit_session_db_id_fkey"
  FOREIGN KEY ("concept_unit_session_db_id") REFERENCES "concept_unit_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_overrides"
  ADD CONSTRAINT "workflow_overrides_created_by_user_db_id_fkey"
  FOREIGN KEY ("created_by_user_db_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
