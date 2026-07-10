-- Phase 31k: safe aggregate audit records for permanent assessment deletion.
-- This table intentionally stores counts and identifiers only. It must not
-- retain deleted item content, student responses, provider payloads, or secrets.

CREATE TABLE "assessment_deletion_events" (
  "id" UUID NOT NULL,
  "deletion_public_id" TEXT NOT NULL,
  "deleted_assessment_public_id" TEXT NOT NULL,
  "deleted_assessment_public_hash" TEXT NOT NULL,
  "assessment_title_snapshot" TEXT NOT NULL,
  "performed_by_user_db_id" UUID NOT NULL,
  "deletion_mode" TEXT NOT NULL,
  "deletion_summary" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assessment_deletion_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assessment_deletion_events_deletion_public_id_key"
  ON "assessment_deletion_events"("deletion_public_id");

CREATE INDEX "assessment_deletion_events_deleted_assessment_public_id_created_at_idx"
  ON "assessment_deletion_events"("deleted_assessment_public_id", "created_at");

CREATE INDEX "assessment_deletion_events_performed_by_user_db_id_created_at_idx"
  ON "assessment_deletion_events"("performed_by_user_db_id", "created_at");

CREATE INDEX "assessment_deletion_events_deletion_mode_created_at_idx"
  ON "assessment_deletion_events"("deletion_mode", "created_at");

ALTER TABLE "assessment_deletion_events"
  ADD CONSTRAINT "assessment_deletion_events_performed_by_user_db_id_fkey"
  FOREIGN KEY ("performed_by_user_db_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
