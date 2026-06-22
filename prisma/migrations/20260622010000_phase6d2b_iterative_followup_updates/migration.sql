-- Phase 6D2B: staged iterative follow-up update cycles.
ALTER TYPE "WorkflowJobType" ADD VALUE IF NOT EXISTS 'run_followup_profile_update';
ALTER TYPE "WorkflowJobType" ADD VALUE IF NOT EXISTS 'run_followup_planning_update';
ALTER TYPE "WorkflowJobType" ADD VALUE IF NOT EXISTS 'finalize_followup_update';

CREATE TYPE "FollowupUpdateCycleStatus" AS ENUM (
  'pending',
  'profiling',
  'profiling_completed',
  'planning',
  'planning_completed',
  'opening',
  'committing',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE "FollowupUpdateTriggerType" AS ENUM (
  'agent_evidence_candidate',
  'reasoning_revision',
  'task_completion',
  'transfer_application',
  'understanding_claim',
  'move_on_request',
  'substantive_turn_threshold',
  'student_stop_final_update',
  'teacher_manual'
);

CREATE TABLE "followup_update_cycles" (
  "id" UUID NOT NULL,
  "cycle_public_id" TEXT NOT NULL,
  "assessment_session_db_id" UUID NOT NULL,
  "concept_unit_session_db_id" UUID NOT NULL,
  "source_followup_round_db_id" UUID NOT NULL,
  "source_student_profile_db_id" UUID NOT NULL,
  "source_formative_decision_db_id" UUID NOT NULL,
  "evidence_package_db_id" UUID,
  "evidence_cutoff_turn_db_id" UUID,
  "evidence_cutoff_at" TIMESTAMPTZ(6),
  "trigger_type" "FollowupUpdateTriggerType" NOT NULL,
  "trigger_details" JSONB NOT NULL,
  "status" "FollowupUpdateCycleStatus" NOT NULL DEFAULT 'pending',
  "final_update" BOOLEAN NOT NULL DEFAULT false,
  "create_next_round" BOOLEAN NOT NULL DEFAULT true,
  "stop_after_cycle" BOOLEAN NOT NULL DEFAULT false,
  "profile_agent_call_db_id" UUID,
  "planning_agent_call_db_id" UUID,
  "opening_agent_call_db_id" UUID,
  "staged_profile_output" JSONB,
  "staged_planning_output" JSONB,
  "staged_opening_output" JSONB,
  "failure_stage" TEXT,
  "failure_category" TEXT,
  "failure_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "completed_at" TIMESTAMPTZ(6),

  CONSTRAINT "followup_update_cycles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "followup_update_cycles_cycle_public_id_key"
  ON "followup_update_cycles"("cycle_public_id");
CREATE INDEX "followup_update_cycles_assessment_session_db_id_created_at_idx"
  ON "followup_update_cycles"("assessment_session_db_id", "created_at");
CREATE INDEX "followup_update_cycles_concept_unit_session_db_id_status_idx"
  ON "followup_update_cycles"("concept_unit_session_db_id", "status");
CREATE INDEX "followup_update_cycles_source_followup_round_db_id_idx"
  ON "followup_update_cycles"("source_followup_round_db_id");
CREATE INDEX "followup_update_cycles_evidence_package_db_id_idx"
  ON "followup_update_cycles"("evidence_package_db_id");
CREATE INDEX "followup_update_cycles_profile_agent_call_db_id_idx"
  ON "followup_update_cycles"("profile_agent_call_db_id");
CREATE INDEX "followup_update_cycles_planning_agent_call_db_id_idx"
  ON "followup_update_cycles"("planning_agent_call_db_id");
CREATE INDEX "followup_update_cycles_opening_agent_call_db_id_idx"
  ON "followup_update_cycles"("opening_agent_call_db_id");
CREATE INDEX "followup_update_cycles_trigger_type_idx"
  ON "followup_update_cycles"("trigger_type");

CREATE UNIQUE INDEX "followup_update_cycles_one_active_per_concept_unit_idx"
  ON "followup_update_cycles"("concept_unit_session_db_id")
  WHERE "status" IN (
    'pending',
    'profiling',
    'profiling_completed',
    'planning',
    'planning_completed',
    'opening',
    'committing'
  );

ALTER TABLE "followup_update_cycles"
  ADD CONSTRAINT "followup_update_cycles_assessment_session_db_id_fkey"
  FOREIGN KEY ("assessment_session_db_id") REFERENCES "assessment_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "followup_update_cycles"
  ADD CONSTRAINT "followup_update_cycles_concept_unit_session_db_id_fkey"
  FOREIGN KEY ("concept_unit_session_db_id") REFERENCES "concept_unit_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "followup_update_cycles"
  ADD CONSTRAINT "followup_update_cycles_source_followup_round_db_id_fkey"
  FOREIGN KEY ("source_followup_round_db_id") REFERENCES "followup_rounds"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "followup_update_cycles"
  ADD CONSTRAINT "followup_update_cycles_source_student_profile_db_id_fkey"
  FOREIGN KEY ("source_student_profile_db_id") REFERENCES "student_profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "followup_update_cycles"
  ADD CONSTRAINT "followup_update_cycles_source_formative_decision_db_id_fkey"
  FOREIGN KEY ("source_formative_decision_db_id") REFERENCES "formative_decisions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "followup_update_cycles"
  ADD CONSTRAINT "followup_update_cycles_evidence_package_db_id_fkey"
  FOREIGN KEY ("evidence_package_db_id") REFERENCES "response_packages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "followup_update_cycles"
  ADD CONSTRAINT "followup_update_cycles_evidence_cutoff_turn_db_id_fkey"
  FOREIGN KEY ("evidence_cutoff_turn_db_id") REFERENCES "conversation_turns"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "followup_update_cycles"
  ADD CONSTRAINT "followup_update_cycles_profile_agent_call_db_id_fkey"
  FOREIGN KEY ("profile_agent_call_db_id") REFERENCES "agent_calls"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "followup_update_cycles"
  ADD CONSTRAINT "followup_update_cycles_planning_agent_call_db_id_fkey"
  FOREIGN KEY ("planning_agent_call_db_id") REFERENCES "agent_calls"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "followup_update_cycles"
  ADD CONSTRAINT "followup_update_cycles_opening_agent_call_db_id_fkey"
  FOREIGN KEY ("opening_agent_call_db_id") REFERENCES "agent_calls"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
