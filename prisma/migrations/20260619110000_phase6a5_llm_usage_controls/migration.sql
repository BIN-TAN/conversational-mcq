-- Phase 6A.5 LLM classroom usage-control audit fields.
-- Existing applied migrations are left intact.

ALTER TABLE "agent_calls"
  ADD COLUMN "blocked_reason" TEXT,
  ADD COLUMN "usage_guard_snapshot" JSONB,
  ADD COLUMN "live_call_allowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "usage_window_start" TIMESTAMPTZ(6),
  ADD COLUMN "usage_window_end" TIMESTAMPTZ(6);

CREATE INDEX "agent_calls_blocked_reason_created_at_idx"
  ON "agent_calls"("blocked_reason", "created_at");

CREATE INDEX "agent_calls_live_call_allowed_created_at_idx"
  ON "agent_calls"("live_call_allowed", "created_at");
