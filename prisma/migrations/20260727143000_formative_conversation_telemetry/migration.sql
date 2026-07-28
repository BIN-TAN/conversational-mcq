-- Phase 1A telemetry: observable formative-conversation process records only.

CREATE TYPE "FormativeConversationLifecycleEventType" AS ENUM (
    'page_visible',
    'page_hidden',
    'left',
    'reentered',
    'refreshed',
    'paused',
    'resumed',
    'disconnected',
    'reconnected',
    'completed'
);

CREATE TYPE "FormativeConversationTypingDurationMethod" AS ENUM (
    'active_intervals',
    'elapsed_first_input_to_submit'
);

ALTER TABLE "agent_calls"
ADD COLUMN "formative_conversation_context_version" TEXT;

CREATE TABLE "formative_conversation_lifecycle_events" (
    "id" UUID NOT NULL,
    "event_public_id" TEXT NOT NULL,
    "formative_conversation_session_db_id" UUID NOT NULL,
    "client_event_id" TEXT NOT NULL,
    "event_hash" TEXT NOT NULL,
    "event_type" "FormativeConversationLifecycleEventType" NOT NULL,
    "event_source" "EventSource" NOT NULL,
    "duration_ms" INTEGER,
    "client_instance_id" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "formative_conversation_lifecycle_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "formative_conversation_turn_telemetry" (
    "id" UUID NOT NULL,
    "formative_conversation_session_db_id" UUID NOT NULL,
    "conversation_turn_db_id" UUID NOT NULL,
    "agent_call_db_id" UUID,
    "turn_sequence_index" INTEGER NOT NULL,
    "turn_started_at" TIMESTAMPTZ(6),
    "turn_submitted_at" TIMESTAMPTZ(6),
    "response_time_ms" INTEGER,
    "message_length_chars" INTEGER NOT NULL,
    "input_token_count" INTEGER,
    "output_token_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "formative_conversation_turn_telemetry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "formative_conversation_input_telemetry" (
    "id" UUID NOT NULL,
    "formative_conversation_session_db_id" UUID NOT NULL,
    "conversation_turn_db_id" UUID NOT NULL,
    "client_message_id" TEXT NOT NULL,
    "typing_started_at" TIMESTAMPTZ(6),
    "typing_ended_at" TIMESTAMPTZ(6),
    "typing_duration_ms" INTEGER,
    "typing_duration_method" "FormativeConversationTypingDurationMethod",
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "backspace_count" INTEGER NOT NULL DEFAULT 0,
    "paste_event_count" INTEGER NOT NULL DEFAULT 0,
    "final_message_length_chars" INTEGER NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "formative_conversation_input_telemetry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "formative_conversation_profile_transitions" (
    "id" UUID NOT NULL,
    "transition_public_id" TEXT NOT NULL,
    "formative_conversation_session_db_id" UUID NOT NULL,
    "prior_student_profile_db_id" UUID NOT NULL,
    "updated_student_profile_db_id" UUID NOT NULL,
    "source_turn_db_id" UUID,
    "source_agent_call_db_id" UUID,
    "transitioned_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "formative_conversation_profile_transitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "formative_conversation_lifecycle_events_public_id_key"
ON "formative_conversation_lifecycle_events"("event_public_id");

CREATE UNIQUE INDEX "formative_conversation_lifecycle_events_client_event_key"
ON "formative_conversation_lifecycle_events"(
    "formative_conversation_session_db_id",
    "client_event_id"
);

CREATE INDEX "formative_conversation_lifecycle_events_session_time_idx"
ON "formative_conversation_lifecycle_events"(
    "formative_conversation_session_db_id",
    "occurred_at"
);

CREATE INDEX "formative_conversation_lifecycle_events_type_time_idx"
ON "formative_conversation_lifecycle_events"("event_type", "occurred_at");

CREATE UNIQUE INDEX "formative_conversation_turn_telemetry_turn_key"
ON "formative_conversation_turn_telemetry"("conversation_turn_db_id");

CREATE UNIQUE INDEX "formative_conversation_turn_telemetry_agent_call_key"
ON "formative_conversation_turn_telemetry"("agent_call_db_id");

CREATE INDEX "formative_conversation_turn_telemetry_session_sequence_idx"
ON "formative_conversation_turn_telemetry"(
    "formative_conversation_session_db_id",
    "turn_sequence_index"
);

CREATE UNIQUE INDEX "formative_conversation_input_telemetry_turn_key"
ON "formative_conversation_input_telemetry"("conversation_turn_db_id");

CREATE UNIQUE INDEX "formative_conversation_input_telemetry_client_message_key"
ON "formative_conversation_input_telemetry"(
    "formative_conversation_session_db_id",
    "client_message_id"
);

CREATE INDEX "formative_conversation_input_telemetry_session_submitted_idx"
ON "formative_conversation_input_telemetry"(
    "formative_conversation_session_db_id",
    "submitted_at"
);

CREATE UNIQUE INDEX "formative_conversation_profile_transitions_public_id_key"
ON "formative_conversation_profile_transitions"("transition_public_id");

CREATE UNIQUE INDEX "formative_conversation_profile_transitions_profile_key"
ON "formative_conversation_profile_transitions"(
    "formative_conversation_session_db_id",
    "updated_student_profile_db_id"
);

CREATE INDEX "formative_conversation_profile_transitions_session_time_idx"
ON "formative_conversation_profile_transitions"(
    "formative_conversation_session_db_id",
    "transitioned_at"
);

CREATE INDEX "formative_conversation_profile_transitions_prior_profile_idx"
ON "formative_conversation_profile_transitions"("prior_student_profile_db_id");

CREATE INDEX "formative_conversation_profile_transitions_source_turn_idx"
ON "formative_conversation_profile_transitions"("source_turn_db_id");

CREATE INDEX "formative_conversation_profile_transitions_source_agent_call_idx"
ON "formative_conversation_profile_transitions"("source_agent_call_db_id");

ALTER TABLE "formative_conversation_lifecycle_events"
ADD CONSTRAINT "formative_conversation_lifecycle_events_session_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_turn_telemetry"
ADD CONSTRAINT "formative_conversation_turn_telemetry_session_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_turn_telemetry"
ADD CONSTRAINT "formative_conversation_turn_telemetry_turn_fkey"
FOREIGN KEY ("conversation_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_turn_telemetry"
ADD CONSTRAINT "formative_conversation_turn_telemetry_agent_call_fkey"
FOREIGN KEY ("agent_call_db_id")
REFERENCES "agent_calls"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_input_telemetry"
ADD CONSTRAINT "formative_conversation_input_telemetry_session_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_input_telemetry"
ADD CONSTRAINT "formative_conversation_input_telemetry_turn_fkey"
FOREIGN KEY ("conversation_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_transitions"
ADD CONSTRAINT "formative_conversation_profile_transitions_session_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_transitions"
ADD CONSTRAINT "formative_conversation_profile_transitions_prior_profile_fkey"
FOREIGN KEY ("prior_student_profile_db_id")
REFERENCES "student_profiles"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_transitions"
ADD CONSTRAINT "formative_conversation_profile_transitions_updated_profile_fkey"
FOREIGN KEY ("updated_student_profile_db_id")
REFERENCES "student_profiles"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_transitions"
ADD CONSTRAINT "formative_conversation_profile_transitions_source_turn_fkey"
FOREIGN KEY ("source_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_transitions"
ADD CONSTRAINT "formative_conversation_profile_transitions_source_agent_call_fkey"
FOREIGN KEY ("source_agent_call_db_id")
REFERENCES "agent_calls"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
