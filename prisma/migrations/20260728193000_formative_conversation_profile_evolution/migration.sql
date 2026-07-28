-- Persist agent-authored formative profile evolution with append-only provenance.

CREATE TYPE "FormativeConversationLearningOutcome" AS ENUM (
    'sound',
    'largely_improved',
    'teacher_assistance_recommended'
);

ALTER TABLE "formative_conversation_profile_transitions"
ADD COLUMN "assessment_student_profile_db_id" UUID,
ADD COLUMN "transition_version" TEXT NOT NULL
    DEFAULT 'formative-conversation-profile-transition-v1',
ADD COLUMN "learning_outcome" "FormativeConversationLearningOutcome",
ADD COLUMN "learning_observations" JSONB,
ADD COLUMN "evidence_interpretation" TEXT,
ADD COLUMN "profile_snapshot" JSONB;

CREATE UNIQUE INDEX "fc_profile_transition_session_agent_call_key"
ON "formative_conversation_profile_transitions"(
    "formative_conversation_session_db_id",
    "source_agent_call_db_id"
);

CREATE INDEX "fc_profile_transition_assessment_profile_idx"
ON "formative_conversation_profile_transitions"(
    "assessment_student_profile_db_id"
);

ALTER TABLE "formative_conversation_profile_transitions"
ADD CONSTRAINT "fc_profile_transition_assessment_profile_fkey"
FOREIGN KEY ("assessment_student_profile_db_id")
REFERENCES "student_profiles"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "formative_conversation_profile_transition_turn_references" (
    "id" UUID NOT NULL,
    "profile_transition_db_id" UUID NOT NULL,
    "conversation_turn_db_id" UUID NOT NULL,
    "evidence_role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fc_profile_transition_turn_references_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fc_profile_transition_turn_transition_turn_key"
ON "formative_conversation_profile_transition_turn_references"(
    "profile_transition_db_id",
    "conversation_turn_db_id"
);

CREATE INDEX "fc_profile_transition_turn_turn_idx"
ON "formative_conversation_profile_transition_turn_references"(
    "conversation_turn_db_id"
);

ALTER TABLE "formative_conversation_profile_transition_turn_references"
ADD CONSTRAINT "fc_profile_transition_turn_transition_fkey"
FOREIGN KEY ("profile_transition_db_id")
REFERENCES "formative_conversation_profile_transitions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_transition_turn_references"
ADD CONSTRAINT "fc_profile_transition_turn_turn_fkey"
FOREIGN KEY ("conversation_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_evidence_references"
ADD COLUMN "profile_transition_db_id" UUID;

CREATE INDEX "fc_profile_evidence_transition_idx"
ON "formative_conversation_profile_evidence_references"(
    "profile_transition_db_id"
);

ALTER TABLE "formative_conversation_profile_evidence_references"
ADD CONSTRAINT "fc_profile_evidence_transition_fkey"
FOREIGN KEY ("profile_transition_db_id")
REFERENCES "formative_conversation_profile_transitions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
