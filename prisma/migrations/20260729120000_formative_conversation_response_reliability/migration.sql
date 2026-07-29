-- Add an explicit assistant-response lifecycle and safe terminal failure telemetry.

CREATE TYPE "FormativeConversationAssistantResponseStatus" AS ENUM (
    'pending',
    'completed',
    'failed',
    'retrying'
);

ALTER TYPE "FormativeConversationLifecycleEventType"
ADD VALUE IF NOT EXISTS 'agent_call_failed';

ALTER TYPE "FormativeConversationLifecycleEventType"
ADD VALUE IF NOT EXISTS 'assistant_response_failed';

ALTER TABLE "formative_conversation_message_receipts"
ADD COLUMN "assistant_response_status" "FormativeConversationAssistantResponseStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN "assistant_response_retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "assistant_response_agent_name" TEXT NOT NULL DEFAULT 'formative_conversation_agent',
ADD COLUMN "assistant_response_last_failure_category" TEXT,
ADD COLUMN "assistant_response_last_failed_at" TIMESTAMPTZ(6);

UPDATE "formative_conversation_message_receipts"
SET "assistant_response_status" =
    CASE
        WHEN "assistant_turn_db_id" IS NOT NULL
            OR "status" = 'assistant_turn_persisted'
            THEN 'completed'::"FormativeConversationAssistantResponseStatus"
        WHEN "status" = 'failed'
            THEN 'failed'::"FormativeConversationAssistantResponseStatus"
        ELSE 'pending'::"FormativeConversationAssistantResponseStatus"
    END;

ALTER TABLE "formative_conversation_message_receipts"
ADD CONSTRAINT "fc_receipt_response_retry_count_nonnegative"
CHECK ("assistant_response_retry_count" >= 0);

ALTER TABLE "agent_calls"
ADD COLUMN "formative_conversation_message_receipt_db_id" UUID;

ALTER TABLE "agent_calls"
ADD CONSTRAINT "agent_calls_formative_conversation_message_receipt_db_id_fkey"
FOREIGN KEY ("formative_conversation_message_receipt_db_id")
REFERENCES "formative_conversation_message_receipts"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "agent_calls_formative_conversation_message_receipt_db_id_created_at_idx"
ON "agent_calls"(
    "formative_conversation_message_receipt_db_id",
    "created_at"
);

UPDATE "agent_calls" AS agent_call
SET "formative_conversation_message_receipt_db_id" = receipt."id"
FROM "formative_conversation_message_receipts" AS receipt
JOIN "conversation_turns" AS tutor_turn
    ON tutor_turn."id" = receipt."assistant_turn_db_id"
WHERE tutor_turn."structured_payload" ->> 'agent_call_db_id' =
    agent_call."id"::TEXT;

ALTER TABLE "formative_conversation_lifecycle_events"
ADD COLUMN "agent_call_db_id" UUID,
ADD COLUMN "agent_name" TEXT,
ADD COLUMN "failure_category" TEXT,
ADD COLUMN "retry_count" INTEGER;

ALTER TABLE "formative_conversation_lifecycle_events"
ADD CONSTRAINT "formative_conversation_lifecycle_events_agent_call_db_id_fkey"
FOREIGN KEY ("agent_call_db_id")
REFERENCES "agent_calls"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_lifecycle_events"
ADD CONSTRAINT "fc_lifecycle_retry_count_nonnegative"
CHECK ("retry_count" IS NULL OR "retry_count" >= 0);

CREATE INDEX "formative_conversation_lifecycle_events_agent_call_db_id_occurred_at_idx"
ON "formative_conversation_lifecycle_events"(
    "agent_call_db_id",
    "occurred_at"
);
