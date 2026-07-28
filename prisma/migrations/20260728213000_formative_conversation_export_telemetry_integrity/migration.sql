-- Add stable public joins and conversation-local observable telemetry ordering.

ALTER TYPE "FormativeConversationLifecycleEventType"
ADD VALUE IF NOT EXISTS 'conversation_ended';

ALTER TABLE "agent_calls"
ADD COLUMN "agent_call_public_id" TEXT;

UPDATE "agent_calls"
SET "agent_call_public_id" =
    'agent_call_' || md5('agent-call-public-v1:' || "id"::text)
WHERE "agent_call_public_id" IS NULL;

ALTER TABLE "agent_calls"
ALTER COLUMN "agent_call_public_id" SET NOT NULL;

CREATE UNIQUE INDEX "agent_calls_agent_call_public_id_key"
ON "agent_calls"("agent_call_public_id");

ALTER TABLE "formative_conversation_sessions"
ADD COLUMN "telemetry_turn_sequence_counter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "telemetry_event_sequence_counter" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "formative_conversation_lifecycle_events"
ADD COLUMN "conversation_local_event_sequence_index" INTEGER;

WITH ranked_events AS (
    SELECT
        "id",
        row_number() OVER (
            PARTITION BY "formative_conversation_session_db_id"
            ORDER BY "sequence_index", "occurred_at", "created_at", "id"
        )::INTEGER AS "local_sequence"
    FROM "formative_conversation_lifecycle_events"
)
UPDATE "formative_conversation_lifecycle_events" AS event
SET "conversation_local_event_sequence_index" =
    ranked_events."local_sequence"
FROM ranked_events
WHERE ranked_events."id" = event."id";

ALTER TABLE "formative_conversation_lifecycle_events"
ALTER COLUMN "conversation_local_event_sequence_index" SET NOT NULL;

CREATE UNIQUE INDEX "fc_lifecycle_session_local_sequence_key"
ON "formative_conversation_lifecycle_events"(
    "formative_conversation_session_db_id",
    "conversation_local_event_sequence_index"
);

UPDATE "formative_conversation_sessions" AS session
SET "telemetry_event_sequence_counter" = event_counts."maximum_sequence"
FROM (
    SELECT
        "formative_conversation_session_db_id" AS "session_id",
        max("conversation_local_event_sequence_index") AS "maximum_sequence"
    FROM "formative_conversation_lifecycle_events"
    GROUP BY "formative_conversation_session_db_id"
) AS event_counts
WHERE event_counts."session_id" = session."id";

ALTER TABLE "formative_conversation_turn_telemetry"
ADD COLUMN "conversation_local_turn_sequence_index" INTEGER;

WITH ranked_turns AS (
    SELECT
        "id",
        row_number() OVER (
            PARTITION BY "formative_conversation_session_db_id"
            ORDER BY "turn_sequence_index", "created_at", "id"
        )::INTEGER AS "local_sequence"
    FROM "formative_conversation_turn_telemetry"
)
UPDATE "formative_conversation_turn_telemetry" AS telemetry
SET "conversation_local_turn_sequence_index" =
    ranked_turns."local_sequence"
FROM ranked_turns
WHERE ranked_turns."id" = telemetry."id";

ALTER TABLE "formative_conversation_turn_telemetry"
ALTER COLUMN "conversation_local_turn_sequence_index" SET NOT NULL;

CREATE UNIQUE INDEX "fc_turn_telemetry_session_local_sequence_key"
ON "formative_conversation_turn_telemetry"(
    "formative_conversation_session_db_id",
    "conversation_local_turn_sequence_index"
);

UPDATE "formative_conversation_sessions" AS session
SET "telemetry_turn_sequence_counter" = turn_counts."maximum_sequence"
FROM (
    SELECT
        "formative_conversation_session_db_id" AS "session_id",
        max("conversation_local_turn_sequence_index") AS "maximum_sequence"
    FROM "formative_conversation_turn_telemetry"
    GROUP BY "formative_conversation_session_db_id"
) AS turn_counts
WHERE turn_counts."session_id" = session."id";

ALTER TABLE "formative_conversation_input_telemetry"
ADD COLUMN "paste_character_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "formative_conversation_lifecycle_events"
ADD CONSTRAINT "fc_lifecycle_local_sequence_positive"
CHECK ("conversation_local_event_sequence_index" > 0);

ALTER TABLE "formative_conversation_turn_telemetry"
ADD CONSTRAINT "fc_turn_telemetry_local_sequence_positive"
CHECK ("conversation_local_turn_sequence_index" > 0);

ALTER TABLE "formative_conversation_input_telemetry"
ADD CONSTRAINT "fc_input_paste_character_count_nonnegative"
CHECK ("paste_character_count" >= 0);
