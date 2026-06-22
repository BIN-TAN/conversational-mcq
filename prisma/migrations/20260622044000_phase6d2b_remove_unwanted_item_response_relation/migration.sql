-- Cleanup for an unintended Prisma relation generated during Phase 6D2B schema validation.
ALTER TABLE "followup_update_cycles"
  DROP CONSTRAINT IF EXISTS "followup_update_cycles_itemResponseId_fkey";

ALTER TABLE "followup_update_cycles"
  DROP COLUMN IF EXISTS "itemResponseId";
