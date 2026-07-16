-- Phase 31ap: production-enable audited student communication and topic dialogue records.

CREATE TABLE "student_communications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "communication_public_id" TEXT NOT NULL,
    "assessment_session_db_id" UUID NOT NULL,
    "concept_unit_session_db_id" UUID,
    "purpose" TEXT NOT NULL,
    "communication_key" TEXT NOT NULL,
    "generation_source" TEXT NOT NULL,
    "runtime_servable_to_student" BOOLEAN NOT NULL DEFAULT true,
    "review_only" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL,
    "model_name" TEXT,
    "agent_call_db_id" UUID,
    "prompt_version" TEXT NOT NULL,
    "input_schema_version" TEXT NOT NULL,
    "output_schema_version" TEXT NOT NULL,
    "validation_status" TEXT NOT NULL,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "fallback_reason" TEXT,
    "source_evidence_hash" TEXT,
    "communication_input" JSONB NOT NULL,
    "communication_output" JSONB NOT NULL,
    "fact_validation_result" JSONB,
    "language_validation_result" JSONB,
    "warnings" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "student_communications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "topic_dialogues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dialogue_public_id" TEXT NOT NULL,
    "assessment_session_db_id" UUID NOT NULL,
    "concept_unit_session_db_id" UUID,
    "activity_attempt_public_id" TEXT NOT NULL,
    "topic_anchor" JSONB NOT NULL,
    "growth_target" TEXT NOT NULL,
    "initial_remaining_issue" TEXT NOT NULL,
    "current_remaining_issue" TEXT NOT NULL,
    "maximum_turns" INTEGER NOT NULL,
    "current_turn" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "topic_dialogues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "topic_dialogue_turns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "turn_public_id" TEXT NOT NULL,
    "dialogue_public_id" TEXT NOT NULL,
    "assessment_session_db_id" UUID NOT NULL,
    "concept_unit_session_db_id" UUID,
    "activity_attempt_public_id" TEXT NOT NULL,
    "turn_number" INTEGER NOT NULL,
    "actor_type" TEXT NOT NULL,
    "message_function" TEXT,
    "topic_relation" TEXT,
    "system_question_answered" BOOLEAN NOT NULL DEFAULT false,
    "evidence_update" TEXT,
    "remaining_issue" TEXT,
    "post_turn_understanding" TEXT,
    "next_action" TEXT,
    "next_runtime_state" TEXT,
    "progression_readiness" TEXT,
    "requires_student_response" BOOLEAN,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "agent_call_db_id" UUID,
    "message_text" TEXT,
    "structured_payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "topic_dialogue_turns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_communications_communication_public_id_key" ON "student_communications"("communication_public_id");
CREATE UNIQUE INDEX "student_communications_communication_key_key" ON "student_communications"("communication_key");
CREATE INDEX "student_communications_assessment_session_db_id_created_at_idx" ON "student_communications"("assessment_session_db_id", "created_at");
CREATE INDEX "student_communications_concept_unit_session_db_id_created_at_idx" ON "student_communications"("concept_unit_session_db_id", "created_at");
CREATE INDEX "student_communications_purpose_created_at_idx" ON "student_communications"("purpose", "created_at");
CREATE INDEX "student_communications_agent_call_db_id_idx" ON "student_communications"("agent_call_db_id");
CREATE INDEX "student_communications_generation_source_validation_status_idx" ON "student_communications"("generation_source", "validation_status");

CREATE UNIQUE INDEX "topic_dialogues_dialogue_public_id_key" ON "topic_dialogues"("dialogue_public_id");
CREATE UNIQUE INDEX "topic_dialogues_assessment_session_db_id_activity_attempt_public_id_key" ON "topic_dialogues"("assessment_session_db_id", "activity_attempt_public_id");
CREATE INDEX "topic_dialogues_assessment_session_db_id_created_at_idx" ON "topic_dialogues"("assessment_session_db_id", "created_at");
CREATE INDEX "topic_dialogues_concept_unit_session_db_id_created_at_idx" ON "topic_dialogues"("concept_unit_session_db_id", "created_at");
CREATE INDEX "topic_dialogues_status_updated_at_idx" ON "topic_dialogues"("status", "updated_at");

CREATE UNIQUE INDEX "topic_dialogue_turns_turn_public_id_key" ON "topic_dialogue_turns"("turn_public_id");
CREATE UNIQUE INDEX "topic_dialogue_turns_dialogue_public_id_turn_number_actor_type_key" ON "topic_dialogue_turns"("dialogue_public_id", "turn_number", "actor_type");
CREATE INDEX "topic_dialogue_turns_dialogue_public_id_turn_number_idx" ON "topic_dialogue_turns"("dialogue_public_id", "turn_number");
CREATE INDEX "topic_dialogue_turns_assessment_session_db_id_created_at_idx" ON "topic_dialogue_turns"("assessment_session_db_id", "created_at");
CREATE INDEX "topic_dialogue_turns_activity_attempt_public_id_created_at_idx" ON "topic_dialogue_turns"("activity_attempt_public_id", "created_at");
CREATE INDEX "topic_dialogue_turns_agent_call_db_id_idx" ON "topic_dialogue_turns"("agent_call_db_id");
