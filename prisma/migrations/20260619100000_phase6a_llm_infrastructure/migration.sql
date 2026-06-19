-- Phase 6A LLM infrastructure audit fields.
-- Existing applied migrations are left intact.

ALTER TABLE "agent_calls"
  ALTER COLUMN "assessment_session_db_id" DROP NOT NULL,
  ALTER COLUMN "temperature" DROP NOT NULL,
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'mock',
  ADD COLUMN "provider_response_id" TEXT,
  ADD COLUMN "provider_request_id" TEXT,
  ADD COLUMN "client_request_id" TEXT,
  ADD COLUMN "agent_invocation_key" TEXT,
  ADD COLUMN "prompt_hash" TEXT,
  ADD COLUMN "reasoning_effort" TEXT,
  ADD COLUMN "verbosity" TEXT,
  ADD COLUMN "max_output_tokens" INTEGER,
  ADD COLUMN "refusal_text" TEXT,
  ADD COLUMN "incomplete_reason" TEXT,
  ADD COLUMN "error_category" TEXT,
  ADD COLUMN "started_at" TIMESTAMPTZ(6),
  ADD COLUMN "completed_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "agent_calls_agent_invocation_key_key"
  ON "agent_calls"("agent_invocation_key");

CREATE INDEX "agent_calls_provider_created_at_idx"
  ON "agent_calls"("provider", "created_at");

CREATE INDEX "agent_calls_client_request_id_idx"
  ON "agent_calls"("client_request_id");
