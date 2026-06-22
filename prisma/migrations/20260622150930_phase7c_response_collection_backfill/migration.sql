-- Backfill assessments that existed before Phase 7C to deterministic mode.
-- The schema default remains llm_assisted for assessments created after this migration.
UPDATE "assessments"
SET "response_collection_mode" = 'deterministic'
WHERE "response_collection_mode" = 'llm_assisted';

