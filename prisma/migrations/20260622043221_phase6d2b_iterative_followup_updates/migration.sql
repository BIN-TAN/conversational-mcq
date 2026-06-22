-- DropForeignKey
ALTER TABLE "followup_update_cycles" DROP CONSTRAINT "followup_update_cycles_evidence_cutoff_turn_db_id_fkey";

-- DropForeignKey
ALTER TABLE "followup_update_cycles" DROP CONSTRAINT "followup_update_cycles_opening_agent_call_db_id_fkey";

-- DropForeignKey
ALTER TABLE "followup_update_cycles" DROP CONSTRAINT "followup_update_cycles_planning_agent_call_db_id_fkey";

-- DropForeignKey
ALTER TABLE "followup_update_cycles" DROP CONSTRAINT "followup_update_cycles_profile_agent_call_db_id_fkey";

-- AlterTable
ALTER TABLE "followup_update_cycles" ADD COLUMN     "itemResponseId" UUID;

-- AddForeignKey
ALTER TABLE "followup_update_cycles" ADD CONSTRAINT "followup_update_cycles_itemResponseId_fkey" FOREIGN KEY ("itemResponseId") REFERENCES "item_responses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
