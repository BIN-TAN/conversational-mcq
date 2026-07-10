-- Phase 31h: safe audit trail for irreversible teacher-controlled student deletion.
-- Stores no credential material, raw response text, raw provider output, or internal student FK.

CREATE TABLE "student_account_deletion_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_public_id" TEXT NOT NULL,
  "student_user_id_snapshot" TEXT NOT NULL,
  "performed_by_user_db_id" UUID NOT NULL,
  "deletion_summary" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_account_deletion_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_account_deletion_events_event_public_id_key"
  ON "student_account_deletion_events"("event_public_id");
CREATE INDEX "student_account_deletion_events_student_user_id_snapshot_created_at_idx"
  ON "student_account_deletion_events"("student_user_id_snapshot", "created_at");
CREATE INDEX "student_account_deletion_events_performed_by_user_db_id_created_at_idx"
  ON "student_account_deletion_events"("performed_by_user_db_id", "created_at");

ALTER TABLE "student_account_deletion_events"
  ADD CONSTRAINT "student_account_deletion_events_performed_by_user_db_id_fkey"
  FOREIGN KEY ("performed_by_user_db_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
