-- AddForeignKey
ALTER TABLE "followup_update_cycles" ADD CONSTRAINT "followup_update_cycles_evidence_cutoff_turn_db_id_fkey" FOREIGN KEY ("evidence_cutoff_turn_db_id") REFERENCES "conversation_turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_update_cycles" ADD CONSTRAINT "followup_update_cycles_profile_agent_call_db_id_fkey" FOREIGN KEY ("profile_agent_call_db_id") REFERENCES "agent_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_update_cycles" ADD CONSTRAINT "followup_update_cycles_planning_agent_call_db_id_fkey" FOREIGN KEY ("planning_agent_call_db_id") REFERENCES "agent_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_update_cycles" ADD CONSTRAINT "followup_update_cycles_opening_agent_call_db_id_fkey" FOREIGN KEY ("opening_agent_call_db_id") REFERENCES "agent_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
