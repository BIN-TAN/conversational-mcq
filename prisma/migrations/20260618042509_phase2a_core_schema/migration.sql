-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "ConceptUnitStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "AssessmentPhase" AS ENUM ('not_started', 'session_started', 'concept_unit_intro', 'initial_item_administration', 'missing_evidence_repair', 'initial_concept_unit_completed', 'profiling_pending', 'profiling_completed', 'planning_pending', 'planning_completed', 'followup_active', 'followup_profile_update_pending', 'followup_planning_update_pending', 'followup_stopped', 'between_concept_units', 'session_completed', 'student_exited', 'needs_review');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('not_started', 'active', 'paused', 'completed', 'student_exited', 'needs_review');

-- CreateEnum
CREATE TYPE "ConceptUnitSessionStatus" AS ENUM ('not_started', 'initial_in_progress', 'initial_completed', 'followup_active', 'followup_completed', 'completed', 'student_exited', 'needs_review');

-- CreateEnum
CREATE TYPE "FollowupStatus" AS ENUM ('not_started', 'active', 'stopped', 'completed', 'incomplete', 'needs_review');

-- CreateEnum
CREATE TYPE "ResponseCorrectness" AS ENUM ('not_scored', 'correct', 'incorrect', 'unanswered');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('student', 'agent', 'system', 'orchestrator', 'teacher_researcher');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('frontend', 'backend', 'agent', 'system');

-- CreateEnum
CREATE TYPE "AgentCallStatus" AS ENUM ('started', 'succeeded', 'failed', 'invalid_output', 'needs_review');

-- CreateEnum
CREATE TYPE "ProfileType" AS ENUM ('initial', 'updated');

-- CreateEnum
CREATE TYPE "AbilityProfile" AS ENUM ('insufficient_evidence', 'minimal_or_no_demonstrated_understanding', 'fragmented_or_limited_understanding', 'partial_understanding', 'misconception_based_understanding', 'fragile_correct_understanding', 'procedural_or_application_error', 'mostly_correct_understanding', 'robust_transfer_ready_understanding');

-- CreateEnum
CREATE TYPE "EngagementProfile" AS ENUM ('insufficient_process_evidence', 'low_engagement', 'variable_engagement', 'adequate_engagement', 'productive_engagement', 'sustained_high_engagement');

-- CreateEnum
CREATE TYPE "IntegratedDiagnosticProfile" AS ENUM ('insufficient_evidence_for_formative_decision', 'low_engagement_limits_interpretability', 'conflicting_evidence_needs_clarification', 'developing_understanding_with_productive_engagement', 'misconception_with_sufficient_engagement', 'correct_but_fragile_understanding', 'correct_but_independence_uncertain', 'underconfident_but_reasoning_supported', 'robust_understanding_ready_for_transfer');

-- CreateEnum
CREATE TYPE "EvidenceSufficiency" AS ENUM ('insufficient', 'limited', 'adequate', 'strong');

-- CreateEnum
CREATE TYPE "ConfidenceAlignment" AS ENUM ('insufficient_evidence', 'underconfident', 'well_calibrated', 'overconfident', 'mixed');

-- CreateEnum
CREATE TYPE "IndependenceInterpretability" AS ENUM ('not_applicable', 'independent_understanding_likely', 'independent_understanding_uncertain', 'insufficient_evidence');

-- CreateEnum
CREATE TYPE "FormativeValue" AS ENUM ('diagnostic_clarification', 'reasoning_refinement', 'confidence_calibration', 'independent_understanding_verification', 'consolidation_or_transfer');

-- CreateEnum
CREATE TYPE "FollowupRoundStatus" AS ENUM ('not_started', 'active', 'completed', 'stopped', 'needs_review');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('requested', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "assessment_public_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'draft',
    "created_by_user_db_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concept_units" (
    "id" UUID NOT NULL,
    "concept_unit_public_id" TEXT NOT NULL,
    "assessment_db_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "learning_objective" TEXT NOT NULL,
    "related_concept_description" TEXT NOT NULL,
    "administration_rules" JSONB,
    "order_index" INTEGER NOT NULL,
    "status" "ConceptUnitStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "concept_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "item_public_id" TEXT NOT NULL,
    "concept_unit_db_id" UUID NOT NULL,
    "item_order" INTEGER NOT NULL,
    "item_stem" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct_option" TEXT NOT NULL,
    "distractor_rationales" JSONB,
    "expected_reasoning_patterns" JSONB,
    "possible_misconception_indicators" JSONB,
    "administration_rules" JSONB,
    "status" "ItemStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_sessions" (
    "id" UUID NOT NULL,
    "session_public_id" TEXT NOT NULL,
    "user_db_id" UUID NOT NULL,
    "assessment_db_id" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'not_started',
    "current_phase" "AssessmentPhase" NOT NULL DEFAULT 'not_started',
    "current_concept_unit_db_id" UUID,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "needs_review_reason" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "last_activity_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assessment_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concept_unit_sessions" (
    "id" UUID NOT NULL,
    "assessment_session_db_id" UUID NOT NULL,
    "concept_unit_db_id" UUID NOT NULL,
    "status" "ConceptUnitSessionStatus" NOT NULL DEFAULT 'not_started',
    "initial_started_at" TIMESTAMPTZ(6),
    "initial_completed_at" TIMESTAMPTZ(6),
    "followup_started_at" TIMESTAMPTZ(6),
    "followup_completed_at" TIMESTAMPTZ(6),
    "followup_status" "FollowupStatus" NOT NULL DEFAULT 'not_started',
    "followup_round_count" INTEGER NOT NULL DEFAULT 0,
    "latest_student_profile_db_id" UUID,
    "latest_formative_decision_db_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "concept_unit_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_responses" (
    "id" UUID NOT NULL,
    "concept_unit_session_db_id" UUID NOT NULL,
    "item_db_id" UUID NOT NULL,
    "selected_option" TEXT,
    "correct_option_snapshot" TEXT NOT NULL,
    "correctness" "ResponseCorrectness" NOT NULL DEFAULT 'not_scored',
    "reasoning_text" TEXT,
    "confidence_rating" "ConfidenceLevel",
    "item_response_time_ms" INTEGER,
    "item_started_at" TIMESTAMPTZ(6),
    "item_submitted_at" TIMESTAMPTZ(6),
    "skipped_reasoning" BOOLEAN NOT NULL DEFAULT false,
    "skipped_confidence" BOOLEAN NOT NULL DEFAULT false,
    "revision_count" INTEGER NOT NULL DEFAULT 0,
    "missing_evidence_repair_offered" BOOLEAN NOT NULL DEFAULT false,
    "item_version_snapshot" INTEGER NOT NULL,
    "item_snapshot" JSONB NOT NULL,
    "client_submission_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "item_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_turns" (
    "id" UUID NOT NULL,
    "assessment_session_db_id" UUID NOT NULL,
    "concept_unit_session_db_id" UUID,
    "item_db_id" UUID,
    "followup_round_db_id" UUID,
    "phase" "AssessmentPhase" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "agent_name" TEXT,
    "message_text" TEXT,
    "structured_payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_events" (
    "id" UUID NOT NULL,
    "assessment_session_db_id" UUID NOT NULL,
    "concept_unit_session_db_id" UUID,
    "item_db_id" UUID,
    "event_type" TEXT NOT NULL,
    "event_category" TEXT NOT NULL,
    "event_source" "EventSource" NOT NULL,
    "visibility_duration_ms" INTEGER,
    "pause_duration_ms" INTEGER,
    "payload" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "process_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_calls" (
    "id" UUID NOT NULL,
    "assessment_session_db_id" UUID NOT NULL,
    "concept_unit_session_db_id" UUID,
    "agent_name" TEXT NOT NULL,
    "agent_version" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "temperature" DECIMAL(4,2) NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "input_payload" JSONB NOT NULL,
    "raw_output" JSONB,
    "output_payload" JSONB,
    "output_validated" BOOLEAN NOT NULL DEFAULT false,
    "validation_error" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "call_status" "AgentCallStatus" NOT NULL DEFAULT 'started',
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "token_usage" JSONB,
    "estimated_cost" DECIMAL(12,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_packages" (
    "id" UUID NOT NULL,
    "concept_unit_session_db_id" UUID NOT NULL,
    "package_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "response_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "id" UUID NOT NULL,
    "concept_unit_session_db_id" UUID NOT NULL,
    "profile_type" "ProfileType" NOT NULL,
    "ability_profile" "AbilityProfile" NOT NULL,
    "ability_pattern_flags" JSONB NOT NULL,
    "engagement_profile" "EngagementProfile" NOT NULL,
    "engagement_pattern_flags" JSONB NOT NULL,
    "integrated_diagnostic_profile" "IntegratedDiagnosticProfile" NOT NULL,
    "integrated_profile_confidence" "ConfidenceLevel" NOT NULL,
    "integrated_profile_rationale" TEXT NOT NULL,
    "evidence_sufficiency" "EvidenceSufficiency" NOT NULL,
    "confidence_alignment" "ConfidenceAlignment" NOT NULL,
    "independence_interpretability" "IndependenceInterpretability" NOT NULL,
    "misconception_indicators" JSONB NOT NULL,
    "item_level_evidence" JSONB NOT NULL,
    "reasoning_quality_summary" TEXT NOT NULL,
    "engagement_summary" TEXT NOT NULL,
    "process_interpretation_cautions" JSONB NOT NULL,
    "profile_confidence" "ConfidenceLevel" NOT NULL,
    "rationale" TEXT NOT NULL,
    "recommended_next_evidence" JSONB NOT NULL,
    "based_on_agent_call_db_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formative_decisions" (
    "id" UUID NOT NULL,
    "concept_unit_session_db_id" UUID NOT NULL,
    "student_profile_db_id" UUID NOT NULL,
    "formative_value" "FormativeValue" NOT NULL,
    "formative_action_plan" TEXT NOT NULL,
    "target_evidence" JSONB NOT NULL,
    "success_criteria" JSONB NOT NULL,
    "followup_prompt_constraints" JSONB NOT NULL,
    "profile_update_triggers" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "mapping_followed" BOOLEAN NOT NULL,
    "mapping_deviation_reason" TEXT,
    "based_on_agent_call_db_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formative_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "followup_rounds" (
    "id" UUID NOT NULL,
    "concept_unit_session_db_id" UUID NOT NULL,
    "round_index" INTEGER NOT NULL,
    "formative_decision_db_id" UUID NOT NULL,
    "status" "FollowupRoundStatus" NOT NULL DEFAULT 'not_started',
    "evidence_trigger_type" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "updated_student_profile_db_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "followup_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "summative_outcomes" (
    "id" UUID NOT NULL,
    "user_db_id" UUID NOT NULL,
    "user_id_snapshot" TEXT NOT NULL,
    "outcome_name" TEXT NOT NULL,
    "outcome_score" DECIMAL(10,2) NOT NULL,
    "max_score" DECIMAL(10,2) NOT NULL,
    "assessment_date" DATE NOT NULL,
    "notes" TEXT,
    "uploaded_by_user_db_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "summative_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "requested_by_user_db_id" UUID NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'requested',
    "file_name" TEXT,
    "row_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "error_message" TEXT,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assessments_assessment_public_id_key" ON "assessments"("assessment_public_id");

-- CreateIndex
CREATE INDEX "assessments_created_by_user_db_id_idx" ON "assessments"("created_by_user_db_id");

-- CreateIndex
CREATE INDEX "assessments_status_idx" ON "assessments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "concept_units_concept_unit_public_id_key" ON "concept_units"("concept_unit_public_id");

-- CreateIndex
CREATE INDEX "concept_units_assessment_db_id_status_idx" ON "concept_units"("assessment_db_id", "status");

-- CreateIndex
CREATE INDEX "concept_units_assessment_db_id_order_index_idx" ON "concept_units"("assessment_db_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "concept_units_assessment_db_id_order_index_key" ON "concept_units"("assessment_db_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "items_item_public_id_key" ON "items"("item_public_id");

-- CreateIndex
CREATE INDEX "items_concept_unit_db_id_status_idx" ON "items"("concept_unit_db_id", "status");

-- CreateIndex
CREATE INDEX "items_concept_unit_db_id_item_order_idx" ON "items"("concept_unit_db_id", "item_order");

-- CreateIndex
CREATE UNIQUE INDEX "items_concept_unit_db_id_item_order_key" ON "items"("concept_unit_db_id", "item_order");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_sessions_session_public_id_key" ON "assessment_sessions"("session_public_id");

-- CreateIndex
CREATE INDEX "assessment_sessions_user_db_id_status_idx" ON "assessment_sessions"("user_db_id", "status");

-- CreateIndex
CREATE INDEX "assessment_sessions_assessment_db_id_status_idx" ON "assessment_sessions"("assessment_db_id", "status");

-- CreateIndex
CREATE INDEX "assessment_sessions_status_current_phase_idx" ON "assessment_sessions"("status", "current_phase");

-- CreateIndex
CREATE INDEX "assessment_sessions_current_concept_unit_db_id_idx" ON "assessment_sessions"("current_concept_unit_db_id");

-- CreateIndex
CREATE INDEX "concept_unit_sessions_assessment_session_db_id_status_idx" ON "concept_unit_sessions"("assessment_session_db_id", "status");

-- CreateIndex
CREATE INDEX "concept_unit_sessions_concept_unit_db_id_idx" ON "concept_unit_sessions"("concept_unit_db_id");

-- CreateIndex
CREATE INDEX "concept_unit_sessions_latest_student_profile_db_id_idx" ON "concept_unit_sessions"("latest_student_profile_db_id");

-- CreateIndex
CREATE INDEX "concept_unit_sessions_latest_formative_decision_db_id_idx" ON "concept_unit_sessions"("latest_formative_decision_db_id");

-- CreateIndex
CREATE UNIQUE INDEX "concept_unit_sessions_assessment_session_db_id_concept_unit_key" ON "concept_unit_sessions"("assessment_session_db_id", "concept_unit_db_id");

-- CreateIndex
CREATE INDEX "item_responses_item_db_id_idx" ON "item_responses"("item_db_id");

-- CreateIndex
CREATE INDEX "item_responses_item_submitted_at_idx" ON "item_responses"("item_submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "item_responses_concept_unit_session_db_id_item_db_id_key" ON "item_responses"("concept_unit_session_db_id", "item_db_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_responses_concept_unit_session_db_id_client_submission_key" ON "item_responses"("concept_unit_session_db_id", "client_submission_id");

-- CreateIndex
CREATE INDEX "conversation_turns_assessment_session_db_id_created_at_idx" ON "conversation_turns"("assessment_session_db_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_turns_concept_unit_session_db_id_created_at_idx" ON "conversation_turns"("concept_unit_session_db_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_turns_item_db_id_idx" ON "conversation_turns"("item_db_id");

-- CreateIndex
CREATE INDEX "conversation_turns_followup_round_db_id_idx" ON "conversation_turns"("followup_round_db_id");

-- CreateIndex
CREATE INDEX "process_events_assessment_session_db_id_occurred_at_idx" ON "process_events"("assessment_session_db_id", "occurred_at");

-- CreateIndex
CREATE INDEX "process_events_concept_unit_session_db_id_occurred_at_idx" ON "process_events"("concept_unit_session_db_id", "occurred_at");

-- CreateIndex
CREATE INDEX "process_events_assessment_session_db_id_event_type_occurred_idx" ON "process_events"("assessment_session_db_id", "event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "process_events_event_type_idx" ON "process_events"("event_type");

-- CreateIndex
CREATE INDEX "process_events_item_db_id_idx" ON "process_events"("item_db_id");

-- CreateIndex
CREATE INDEX "agent_calls_assessment_session_db_id_created_at_idx" ON "agent_calls"("assessment_session_db_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_calls_concept_unit_session_db_id_created_at_idx" ON "agent_calls"("concept_unit_session_db_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_calls_agent_name_call_status_idx" ON "agent_calls"("agent_name", "call_status");

-- CreateIndex
CREATE INDEX "response_packages_concept_unit_session_db_id_created_at_idx" ON "response_packages"("concept_unit_session_db_id", "created_at");

-- CreateIndex
CREATE INDEX "response_packages_package_type_idx" ON "response_packages"("package_type");

-- CreateIndex
CREATE INDEX "student_profiles_concept_unit_session_db_id_created_at_idx" ON "student_profiles"("concept_unit_session_db_id", "created_at");

-- CreateIndex
CREATE INDEX "student_profiles_ability_profile_idx" ON "student_profiles"("ability_profile");

-- CreateIndex
CREATE INDEX "student_profiles_engagement_profile_idx" ON "student_profiles"("engagement_profile");

-- CreateIndex
CREATE INDEX "student_profiles_integrated_diagnostic_profile_idx" ON "student_profiles"("integrated_diagnostic_profile");

-- CreateIndex
CREATE INDEX "student_profiles_based_on_agent_call_db_id_idx" ON "student_profiles"("based_on_agent_call_db_id");

-- CreateIndex
CREATE INDEX "formative_decisions_concept_unit_session_db_id_created_at_idx" ON "formative_decisions"("concept_unit_session_db_id", "created_at");

-- CreateIndex
CREATE INDEX "formative_decisions_student_profile_db_id_idx" ON "formative_decisions"("student_profile_db_id");

-- CreateIndex
CREATE INDEX "formative_decisions_formative_value_idx" ON "formative_decisions"("formative_value");

-- CreateIndex
CREATE INDEX "formative_decisions_based_on_agent_call_db_id_idx" ON "formative_decisions"("based_on_agent_call_db_id");

-- CreateIndex
CREATE INDEX "followup_rounds_concept_unit_session_db_id_status_idx" ON "followup_rounds"("concept_unit_session_db_id", "status");

-- CreateIndex
CREATE INDEX "followup_rounds_formative_decision_db_id_idx" ON "followup_rounds"("formative_decision_db_id");

-- CreateIndex
CREATE INDEX "followup_rounds_updated_student_profile_db_id_idx" ON "followup_rounds"("updated_student_profile_db_id");

-- CreateIndex
CREATE UNIQUE INDEX "followup_rounds_concept_unit_session_db_id_round_index_key" ON "followup_rounds"("concept_unit_session_db_id", "round_index");

-- CreateIndex
CREATE INDEX "summative_outcomes_user_db_id_assessment_date_idx" ON "summative_outcomes"("user_db_id", "assessment_date");

-- CreateIndex
CREATE INDEX "summative_outcomes_uploaded_by_user_db_id_idx" ON "summative_outcomes"("uploaded_by_user_db_id");

-- CreateIndex
CREATE INDEX "summative_outcomes_outcome_name_idx" ON "summative_outcomes"("outcome_name");

-- CreateIndex
CREATE INDEX "export_jobs_requested_by_user_db_id_created_at_idx" ON "export_jobs"("requested_by_user_db_id", "created_at");

-- CreateIndex
CREATE INDEX "export_jobs_status_idx" ON "export_jobs"("status");

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_user_db_id_fkey" FOREIGN KEY ("created_by_user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_units" ADD CONSTRAINT "concept_units_assessment_db_id_fkey" FOREIGN KEY ("assessment_db_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_concept_unit_db_id_fkey" FOREIGN KEY ("concept_unit_db_id") REFERENCES "concept_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_user_db_id_fkey" FOREIGN KEY ("user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_assessment_db_id_fkey" FOREIGN KEY ("assessment_db_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_current_concept_unit_db_id_fkey" FOREIGN KEY ("current_concept_unit_db_id") REFERENCES "concept_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_unit_sessions" ADD CONSTRAINT "concept_unit_sessions_assessment_session_db_id_fkey" FOREIGN KEY ("assessment_session_db_id") REFERENCES "assessment_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_unit_sessions" ADD CONSTRAINT "concept_unit_sessions_concept_unit_db_id_fkey" FOREIGN KEY ("concept_unit_db_id") REFERENCES "concept_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_unit_sessions" ADD CONSTRAINT "concept_unit_sessions_latest_student_profile_db_id_fkey" FOREIGN KEY ("latest_student_profile_db_id") REFERENCES "student_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_unit_sessions" ADD CONSTRAINT "concept_unit_sessions_latest_formative_decision_db_id_fkey" FOREIGN KEY ("latest_formative_decision_db_id") REFERENCES "formative_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_responses" ADD CONSTRAINT "item_responses_concept_unit_session_db_id_fkey" FOREIGN KEY ("concept_unit_session_db_id") REFERENCES "concept_unit_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_responses" ADD CONSTRAINT "item_responses_item_db_id_fkey" FOREIGN KEY ("item_db_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_assessment_session_db_id_fkey" FOREIGN KEY ("assessment_session_db_id") REFERENCES "assessment_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_concept_unit_session_db_id_fkey" FOREIGN KEY ("concept_unit_session_db_id") REFERENCES "concept_unit_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_item_db_id_fkey" FOREIGN KEY ("item_db_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_followup_round_db_id_fkey" FOREIGN KEY ("followup_round_db_id") REFERENCES "followup_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_events" ADD CONSTRAINT "process_events_assessment_session_db_id_fkey" FOREIGN KEY ("assessment_session_db_id") REFERENCES "assessment_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_events" ADD CONSTRAINT "process_events_concept_unit_session_db_id_fkey" FOREIGN KEY ("concept_unit_session_db_id") REFERENCES "concept_unit_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_events" ADD CONSTRAINT "process_events_item_db_id_fkey" FOREIGN KEY ("item_db_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_calls" ADD CONSTRAINT "agent_calls_assessment_session_db_id_fkey" FOREIGN KEY ("assessment_session_db_id") REFERENCES "assessment_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_calls" ADD CONSTRAINT "agent_calls_concept_unit_session_db_id_fkey" FOREIGN KEY ("concept_unit_session_db_id") REFERENCES "concept_unit_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_packages" ADD CONSTRAINT "response_packages_concept_unit_session_db_id_fkey" FOREIGN KEY ("concept_unit_session_db_id") REFERENCES "concept_unit_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_concept_unit_session_db_id_fkey" FOREIGN KEY ("concept_unit_session_db_id") REFERENCES "concept_unit_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_based_on_agent_call_db_id_fkey" FOREIGN KEY ("based_on_agent_call_db_id") REFERENCES "agent_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formative_decisions" ADD CONSTRAINT "formative_decisions_concept_unit_session_db_id_fkey" FOREIGN KEY ("concept_unit_session_db_id") REFERENCES "concept_unit_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formative_decisions" ADD CONSTRAINT "formative_decisions_student_profile_db_id_fkey" FOREIGN KEY ("student_profile_db_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formative_decisions" ADD CONSTRAINT "formative_decisions_based_on_agent_call_db_id_fkey" FOREIGN KEY ("based_on_agent_call_db_id") REFERENCES "agent_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_rounds" ADD CONSTRAINT "followup_rounds_concept_unit_session_db_id_fkey" FOREIGN KEY ("concept_unit_session_db_id") REFERENCES "concept_unit_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_rounds" ADD CONSTRAINT "followup_rounds_formative_decision_db_id_fkey" FOREIGN KEY ("formative_decision_db_id") REFERENCES "formative_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_rounds" ADD CONSTRAINT "followup_rounds_updated_student_profile_db_id_fkey" FOREIGN KEY ("updated_student_profile_db_id") REFERENCES "student_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summative_outcomes" ADD CONSTRAINT "summative_outcomes_user_db_id_fkey" FOREIGN KEY ("user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summative_outcomes" ADD CONSTRAINT "summative_outcomes_uploaded_by_user_db_id_fkey" FOREIGN KEY ("uploaded_by_user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_user_db_id_fkey" FOREIGN KEY ("requested_by_user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
