ALTER TABLE "operational_live_canary_steps"
  ADD COLUMN "blocked_reason" TEXT,
  ADD COLUMN "readiness_snapshot_json" JSONB;

CREATE INDEX "operational_live_canary_steps_blocked_reason_idx"
  ON "operational_live_canary_steps"("blocked_reason");
