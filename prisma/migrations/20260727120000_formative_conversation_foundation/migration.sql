-- Phase 1A: additive persistence foundation for LLM-hosted formative conversations.

CREATE TYPE "FormativeConversationStatus" AS ENUM (
    'active',
    'paused',
    'completed',
    'teacher_assistance_recommended',
    'ended'
);

CREATE TYPE "FormativeConversationReceiptStatus" AS ENUM (
    'reserved',
    'student_turn_persisted',
    'assistant_turn_persisted',
    'failed'
);

CREATE TYPE "FormativeConversationInterventionStatus" AS ENUM (
    'active',
    'completed',
    'abandoned'
);

CREATE TYPE "FormativeConversationReviewStatus" AS ENUM (
    'open',
    'acknowledged',
    'resolved',
    'dismissed'
);

ALTER TABLE "conversation_turns"
ADD COLUMN "formative_conversation_session_db_id" UUID;

ALTER TABLE "agent_calls"
ADD COLUMN "formative_conversation_session_db_id" UUID;

ALTER TABLE "activity_runtime_attempts"
ADD COLUMN "formative_conversation_session_db_id" UUID;

CREATE TABLE "formative_conversation_sessions" (
    "id" UUID NOT NULL,
    "conversation_public_id" TEXT NOT NULL,
    "assessment_session_db_id" UUID NOT NULL,
    "concept_unit_session_db_id" UUID NOT NULL,
    "initial_student_profile_db_id" UUID,
    "current_student_profile_db_id" UUID,
    "status" "FormativeConversationStatus" NOT NULL DEFAULT 'active',
    "host_agent_name" TEXT NOT NULL DEFAULT 'formative_conversation_agent',
    "agent_contract_version" TEXT NOT NULL DEFAULT 'formative-conversation-agent-contract-v1',
    "context_contract_version" TEXT NOT NULL DEFAULT 'formative-conversation-context-v1',
    "memory_contract_version" TEXT NOT NULL DEFAULT 'formative-conversation-memory-v1',
    "safety_boundary_version" TEXT NOT NULL DEFAULT 'formative-conversation-safety-boundary-v1',
    "concurrency_version" INTEGER NOT NULL DEFAULT 0,
    "last_processed_turn_sequence" INTEGER,
    "lifecycle_reason" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paused_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "formative_conversation_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "formative_conversation_message_receipts" (
    "id" UUID NOT NULL,
    "receipt_public_id" TEXT NOT NULL,
    "formative_conversation_session_db_id" UUID NOT NULL,
    "client_message_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "FormativeConversationReceiptStatus" NOT NULL DEFAULT 'reserved',
    "student_turn_db_id" UUID,
    "assistant_turn_db_id" UUID,
    "response_payload" JSONB,
    "failure_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    CONSTRAINT "formative_conversation_message_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "formative_conversation_memory_snapshots" (
    "id" UUID NOT NULL,
    "snapshot_public_id" TEXT NOT NULL,
    "formative_conversation_session_db_id" UUID NOT NULL,
    "snapshot_index" INTEGER NOT NULL,
    "schema_version" TEXT NOT NULL,
    "through_turn_db_id" UUID,
    "source_transcript_hash" TEXT NOT NULL,
    "summary_payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "formative_conversation_memory_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "formative_conversation_interventions" (
    "id" UUID NOT NULL,
    "intervention_public_id" TEXT NOT NULL,
    "formative_conversation_session_db_id" UUID NOT NULL,
    "activity_runtime_attempt_db_id" UUID,
    "strategy_type" TEXT NOT NULL,
    "targeted_evidence_gap" TEXT NOT NULL,
    "status" "FormativeConversationInterventionStatus" NOT NULL DEFAULT 'active',
    "started_by_turn_db_id" UUID,
    "completed_by_turn_db_id" UUID,
    "outcome_evidence" JSONB,
    "adaptation_history" JSONB NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "formative_conversation_interventions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "formative_conversation_review_signals" (
    "id" UUID NOT NULL,
    "signal_public_id" TEXT NOT NULL,
    "formative_conversation_session_db_id" UUID NOT NULL,
    "source_student_profile_db_id" UUID,
    "source_turn_db_id" UUID,
    "signal_type" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "status" "FormativeConversationReviewStatus" NOT NULL DEFAULT 'open',
    "evidence_summary" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "formative_conversation_review_signals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "formative_conversation_sessions_conversation_public_id_key"
ON "formative_conversation_sessions"("conversation_public_id");

CREATE UNIQUE INDEX "formative_conversation_sessions_concept_unit_session_db_id_key"
ON "formative_conversation_sessions"("concept_unit_session_db_id");

CREATE INDEX "formative_conversation_sessions_assessment_session_db_id_st_idx"
ON "formative_conversation_sessions"("assessment_session_db_id", "status");

CREATE INDEX "formative_conversation_sessions_initial_student_profile_db__idx"
ON "formative_conversation_sessions"("initial_student_profile_db_id");

CREATE INDEX "formative_conversation_sessions_current_student_profile_db__idx"
ON "formative_conversation_sessions"("current_student_profile_db_id");

CREATE INDEX "formative_conversation_sessions_status_last_activity_at_idx"
ON "formative_conversation_sessions"("status", "last_activity_at");

CREATE UNIQUE INDEX "formative_conversation_message_receipts_receipt_public_id_key"
ON "formative_conversation_message_receipts"("receipt_public_id");

CREATE UNIQUE INDEX "formative_conversation_message_receipts_student_turn_db_id_key"
ON "formative_conversation_message_receipts"("student_turn_db_id");

CREATE UNIQUE INDEX "formative_conversation_message_receipts_assistant_turn_db_i_key"
ON "formative_conversation_message_receipts"("assistant_turn_db_id");

CREATE INDEX "formative_conversation_message_receipts_formative_conversat_idx"
ON "formative_conversation_message_receipts"(
    "formative_conversation_session_db_id",
    "status",
    "created_at"
);

CREATE UNIQUE INDEX "formative_conversation_message_receipts_formative_conversat_key"
ON "formative_conversation_message_receipts"(
    "formative_conversation_session_db_id",
    "client_message_id"
);

CREATE UNIQUE INDEX "formative_conversation_memory_snapshots_snapshot_public_id_key"
ON "formative_conversation_memory_snapshots"("snapshot_public_id");

CREATE INDEX "formative_conversation_memory_snapshots_formative_conversat_idx"
ON "formative_conversation_memory_snapshots"(
    "formative_conversation_session_db_id",
    "created_at"
);

CREATE INDEX "formative_conversation_memory_snapshots_through_turn_db_id_idx"
ON "formative_conversation_memory_snapshots"("through_turn_db_id");

CREATE UNIQUE INDEX "formative_conversation_memory_snapshots_formative_conversat_key"
ON "formative_conversation_memory_snapshots"(
    "formative_conversation_session_db_id",
    "snapshot_index"
);

CREATE UNIQUE INDEX "formative_conversation_interventions_intervention_public_id_key"
ON "formative_conversation_interventions"("intervention_public_id");

CREATE INDEX "formative_conversation_interventions_formative_conversation_idx"
ON "formative_conversation_interventions"(
    "formative_conversation_session_db_id",
    "status",
    "created_at"
);

CREATE INDEX "formative_conversation_interventions_activity_runtime_attem_idx"
ON "formative_conversation_interventions"("activity_runtime_attempt_db_id");

CREATE INDEX "formative_conversation_interventions_started_by_turn_db_id_idx"
ON "formative_conversation_interventions"("started_by_turn_db_id");

CREATE INDEX "formative_conversation_interventions_completed_by_turn_db_i_idx"
ON "formative_conversation_interventions"("completed_by_turn_db_id");

CREATE UNIQUE INDEX "formative_conversation_review_signals_signal_public_id_key"
ON "formative_conversation_review_signals"("signal_public_id");

CREATE INDEX "formative_conversation_review_signals_formative_conversatio_idx"
ON "formative_conversation_review_signals"(
    "formative_conversation_session_db_id",
    "status",
    "created_at"
);

CREATE INDEX "formative_conversation_review_signals_source_student_profil_idx"
ON "formative_conversation_review_signals"("source_student_profile_db_id");

CREATE INDEX "formative_conversation_review_signals_source_turn_db_id_idx"
ON "formative_conversation_review_signals"("source_turn_db_id");

CREATE INDEX "conversation_turns_formative_conversation_session_db_id_seq_idx"
ON "conversation_turns"("formative_conversation_session_db_id", "sequence_index");

CREATE INDEX "agent_calls_formative_conversation_session_db_id_created_at_idx"
ON "agent_calls"("formative_conversation_session_db_id", "created_at");

CREATE INDEX "activity_runtime_attempts_formative_conversation_session_db_idx"
ON "activity_runtime_attempts"("formative_conversation_session_db_id", "created_at");

ALTER TABLE "conversation_turns"
ADD CONSTRAINT "conversation_turns_formative_conversation_session_db_id_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_calls"
ADD CONSTRAINT "agent_calls_formative_conversation_session_db_id_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "activity_runtime_attempts"
ADD CONSTRAINT "activity_runtime_attempts_formative_conversation_session_d_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_sessions"
ADD CONSTRAINT "formative_conversation_sessions_assessment_session_db_id_fkey"
FOREIGN KEY ("assessment_session_db_id")
REFERENCES "assessment_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_sessions"
ADD CONSTRAINT "formative_conversation_sessions_concept_unit_session_db_id_fkey"
FOREIGN KEY ("concept_unit_session_db_id")
REFERENCES "concept_unit_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_sessions"
ADD CONSTRAINT "formative_conversation_sessions_initial_student_profile_db_fkey"
FOREIGN KEY ("initial_student_profile_db_id")
REFERENCES "student_profiles"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_sessions"
ADD CONSTRAINT "formative_conversation_sessions_current_student_profile_db_fkey"
FOREIGN KEY ("current_student_profile_db_id")
REFERENCES "student_profiles"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_message_receipts"
ADD CONSTRAINT "formative_conversation_message_receipts_formative_conversa_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_message_receipts"
ADD CONSTRAINT "formative_conversation_message_receipts_student_turn_db_id_fkey"
FOREIGN KEY ("student_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_message_receipts"
ADD CONSTRAINT "formative_conversation_message_receipts_assistant_turn_db__fkey"
FOREIGN KEY ("assistant_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_memory_snapshots"
ADD CONSTRAINT "formative_conversation_memory_snapshots_formative_conversa_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_memory_snapshots"
ADD CONSTRAINT "formative_conversation_memory_snapshots_through_turn_db_id_fkey"
FOREIGN KEY ("through_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_interventions"
ADD CONSTRAINT "formative_conversation_interventions_formative_conversatio_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_interventions"
ADD CONSTRAINT "formative_conversation_interventions_activity_runtime_atte_fkey"
FOREIGN KEY ("activity_runtime_attempt_db_id")
REFERENCES "activity_runtime_attempts"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_interventions"
ADD CONSTRAINT "formative_conversation_interventions_started_by_turn_db_id_fkey"
FOREIGN KEY ("started_by_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_interventions"
ADD CONSTRAINT "formative_conversation_interventions_completed_by_turn_db__fkey"
FOREIGN KEY ("completed_by_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_review_signals"
ADD CONSTRAINT "formative_conversation_review_signals_formative_conversati_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_review_signals"
ADD CONSTRAINT "formative_conversation_review_signals_source_student_profi_fkey"
FOREIGN KEY ("source_student_profile_db_id")
REFERENCES "student_profiles"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_review_signals"
ADD CONSTRAINT "formative_conversation_review_signals_source_turn_db_id_fkey"
FOREIGN KEY ("source_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
