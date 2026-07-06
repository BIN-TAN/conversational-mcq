-- Phase 30d: immutable post-activity misconception evidence and diagnostic review snapshots.

CREATE TABLE "activity_misconception_evidence_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evidence_public_id" TEXT NOT NULL,
    "session_public_id" TEXT NOT NULL,
    "student_public_id" TEXT NOT NULL,
    "assessment_public_id" TEXT NOT NULL,
    "concept_unit_id" TEXT NOT NULL,
    "activity_attempt_id" TEXT NOT NULL,
    "source_activity_packet_ref" JSONB,
    "source_evaluator_agent_call_db_id" UUID,
    "schema_version" TEXT NOT NULL,
    "evaluation_source" TEXT NOT NULL,
    "review_only" BOOLEAN NOT NULL DEFAULT false,
    "runtime_servable_to_student" BOOLEAN NOT NULL DEFAULT false,
    "production_mode" TEXT NOT NULL,
    "diagnostic_purpose" TEXT NOT NULL,
    "activity_family" TEXT NOT NULL,
    "student_response_kind" TEXT NOT NULL,
    "evidence_elicited_types" JSONB NOT NULL,
    "misconception_update_status" TEXT NOT NULL,
    "evidence_quality" TEXT NOT NULL,
    "recommended_next_diagnostic_purpose" TEXT NOT NULL,
    "student_safe_feedback" JSONB NOT NULL,
    "safety_flags" JSONB NOT NULL,
    "limitations" JSONB NOT NULL,
    "evidence_packet" JSONB NOT NULL,
    "evidence_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_misconception_evidence_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "post_activity_diagnostic_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_public_id" TEXT NOT NULL,
    "evidence_record_db_id" UUID NOT NULL,
    "session_public_id" TEXT NOT NULL,
    "student_public_id" TEXT NOT NULL,
    "assessment_public_id" TEXT NOT NULL,
    "concept_unit_id" TEXT NOT NULL,
    "activity_attempt_id" TEXT NOT NULL,
    "pre_activity_diagnostic_state" TEXT,
    "activity_update_status" TEXT NOT NULL,
    "post_activity_diagnostic_state" TEXT NOT NULL,
    "update_strength" TEXT NOT NULL,
    "evidence_quality" TEXT NOT NULL,
    "next_diagnostic_purpose" TEXT NOT NULL,
    "student_safe_feedback" JSONB NOT NULL,
    "limitations" JSONB NOT NULL,
    "snapshot_payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_activity_diagnostic_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activity_misconception_evidence_records_evidence_public_id_key"
    ON "activity_misconception_evidence_records"("evidence_public_id");

CREATE UNIQUE INDEX "activity_misconception_evidence_attempt_hash_mode_key"
    ON "activity_misconception_evidence_records"("activity_attempt_id", "evidence_hash", "production_mode");

CREATE INDEX "activity_misconception_evidence_records_session_public_id_created_at_idx"
    ON "activity_misconception_evidence_records"("session_public_id", "created_at");

CREATE INDEX "activity_misconception_evidence_records_student_public_id_created_at_idx"
    ON "activity_misconception_evidence_records"("student_public_id", "created_at");

CREATE INDEX "activity_misconception_evidence_records_assessment_public_id_created_at_idx"
    ON "activity_misconception_evidence_records"("assessment_public_id", "created_at");

CREATE INDEX "activity_misconception_evidence_records_concept_unit_id_created_at_idx"
    ON "activity_misconception_evidence_records"("concept_unit_id", "created_at");

CREATE INDEX "activity_misconception_evidence_records_source_evaluator_agent_call_db_id_idx"
    ON "activity_misconception_evidence_records"("source_evaluator_agent_call_db_id");

CREATE INDEX "activity_misconception_evidence_records_evaluation_source_production_mode_idx"
    ON "activity_misconception_evidence_records"("evaluation_source", "production_mode");

CREATE UNIQUE INDEX "post_activity_diagnostic_snapshots_snapshot_public_id_key"
    ON "post_activity_diagnostic_snapshots"("snapshot_public_id");

CREATE UNIQUE INDEX "post_activity_diagnostic_snapshot_evidence_record_key"
    ON "post_activity_diagnostic_snapshots"("evidence_record_db_id");

CREATE INDEX "post_activity_diagnostic_snapshots_session_public_id_created_at_idx"
    ON "post_activity_diagnostic_snapshots"("session_public_id", "created_at");

CREATE INDEX "post_activity_diagnostic_snapshots_student_public_id_created_at_idx"
    ON "post_activity_diagnostic_snapshots"("student_public_id", "created_at");

CREATE INDEX "post_activity_diagnostic_snapshots_activity_update_status_idx"
    ON "post_activity_diagnostic_snapshots"("activity_update_status");

ALTER TABLE "activity_misconception_evidence_records"
    ADD CONSTRAINT "activity_misconception_evidence_records_source_evaluator_agent_call_db_id_fkey"
    FOREIGN KEY ("source_evaluator_agent_call_db_id") REFERENCES "agent_calls"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "post_activity_diagnostic_snapshots"
    ADD CONSTRAINT "post_activity_diagnostic_snapshots_evidence_record_db_id_fkey"
    FOREIGN KEY ("evidence_record_db_id") REFERENCES "activity_misconception_evidence_records"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
