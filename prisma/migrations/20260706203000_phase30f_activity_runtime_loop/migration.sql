-- Phase 30f: backend runtime loop skeleton for post-activity misconception evidence handling.

CREATE TABLE "activity_runtime_attempts" (
    "id" UUID NOT NULL,
    "activity_attempt_public_id" TEXT NOT NULL,
    "session_public_id" TEXT NOT NULL,
    "student_public_id" TEXT NOT NULL,
    "assessment_public_id" TEXT NOT NULL,
    "concept_unit_id" TEXT NOT NULL,
    "source_activity_packet_ref" JSONB NOT NULL,
    "activity_family" TEXT NOT NULL,
    "diagnostic_purpose" TEXT NOT NULL,
    "generation_source" TEXT NOT NULL,
    "first_turn_agent_call_db_id" UUID,
    "reviewer_agent_call_db_id" UUID,
    "repair_agent_call_db_id" UUID,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "latest_activity_response_reference" JSONB,
    "latest_evidence_record_public_id" TEXT,
    "latest_snapshot_public_id" TEXT,
    "limitations" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "activity_runtime_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activity_runtime_attempts_activity_attempt_public_id_key"
    ON "activity_runtime_attempts"("activity_attempt_public_id");

CREATE INDEX "activity_runtime_attempts_session_public_id_created_at_idx"
    ON "activity_runtime_attempts"("session_public_id", "created_at");

CREATE INDEX "activity_runtime_attempts_student_public_id_created_at_idx"
    ON "activity_runtime_attempts"("student_public_id", "created_at");

CREATE INDEX "activity_runtime_attempts_assessment_public_id_created_at_idx"
    ON "activity_runtime_attempts"("assessment_public_id", "created_at");

CREATE INDEX "activity_runtime_attempts_concept_unit_id_created_at_idx"
    ON "activity_runtime_attempts"("concept_unit_id", "created_at");

CREATE INDEX "activity_runtime_attempts_status_created_at_idx"
    ON "activity_runtime_attempts"("status", "created_at");

CREATE INDEX "activity_runtime_attempts_latest_evidence_record_public_id_idx"
    ON "activity_runtime_attempts"("latest_evidence_record_public_id");
