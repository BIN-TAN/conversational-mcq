-- Phase 1B: observable runtime sequencing and profile-evidence provenance.

ALTER TYPE "FormativeConversationLifecycleEventType"
ADD VALUE IF NOT EXISTS 'session_started';

ALTER TYPE "FormativeConversationLifecycleEventType"
ADD VALUE IF NOT EXISTS 'student_message_persisted';

ALTER TYPE "FormativeConversationLifecycleEventType"
ADD VALUE IF NOT EXISTS 'agent_call_started';

ALTER TYPE "FormativeConversationLifecycleEventType"
ADD VALUE IF NOT EXISTS 'agent_call_completed';

ALTER TYPE "FormativeConversationLifecycleEventType"
ADD VALUE IF NOT EXISTS 'tutor_message_persisted';

ALTER TABLE "formative_conversation_lifecycle_events"
ADD COLUMN "sequence_index" SERIAL NOT NULL;

CREATE UNIQUE INDEX "formative_conversation_lifecycle_events_sequence_index_key"
ON "formative_conversation_lifecycle_events"("sequence_index");

CREATE INDEX "fc_lifecycle_session_sequence_idx"
ON "formative_conversation_lifecycle_events"(
    "formative_conversation_session_db_id",
    "sequence_index"
);

CREATE TABLE "formative_conversation_profile_evidence_references" (
    "id" UUID NOT NULL,
    "evidence_reference_public_id" TEXT NOT NULL,
    "formative_conversation_session_db_id" UUID NOT NULL,
    "source_agent_call_db_id" UUID NOT NULL,
    "source_tutor_turn_db_id" UUID NOT NULL,
    "evidence_observation_index" INTEGER NOT NULL,
    "source_turn_sequence_indexes" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "formative_conversation_profile_evidence_references_pkey"
        PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "formative_conversation_profile_evidence_references_public_id_key"
ON "formative_conversation_profile_evidence_references"(
    "evidence_reference_public_id"
);

CREATE UNIQUE INDEX "formative_conversation_profile_evidence_references_agent_index_key"
ON "formative_conversation_profile_evidence_references"(
    "source_agent_call_db_id",
    "evidence_observation_index"
);

CREATE INDEX "formative_conversation_profile_evidence_references_session_time_idx"
ON "formative_conversation_profile_evidence_references"(
    "formative_conversation_session_db_id",
    "created_at"
);

CREATE INDEX "formative_conversation_profile_evidence_references_tutor_turn_idx"
ON "formative_conversation_profile_evidence_references"(
    "source_tutor_turn_db_id"
);

ALTER TABLE "formative_conversation_profile_evidence_references"
ADD CONSTRAINT "fc_profile_evidence_session_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_evidence_references"
ADD CONSTRAINT "fc_profile_evidence_agent_call_fkey"
FOREIGN KEY ("source_agent_call_db_id")
REFERENCES "agent_calls"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_evidence_references"
ADD CONSTRAINT "fc_profile_evidence_tutor_turn_fkey"
FOREIGN KEY ("source_tutor_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
