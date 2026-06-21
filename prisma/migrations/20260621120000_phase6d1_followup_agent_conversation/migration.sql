-- Add nullable follow-up round audit linkage for Follow-up Agent calls.
ALTER TABLE "agent_calls" ADD COLUMN "followup_round_db_id" UUID;

CREATE INDEX "agent_calls_followup_round_db_id_created_at_idx" ON "agent_calls"("followup_round_db_id", "created_at");

ALTER TABLE "agent_calls"
  ADD CONSTRAINT "agent_calls_followup_round_db_id_fkey"
  FOREIGN KEY ("followup_round_db_id") REFERENCES "followup_rounds"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
