-- Phase 7A: roster import and student account management.
-- Stop before changing the users table if existing user IDs collide under normalized matching.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(btrim(user_id)) AS normalized_user_id, count(*) AS user_count
      FROM users
      GROUP BY lower(btrim(user_id))
      HAVING count(*) > 1
    ) collisions
  ) THEN
    RAISE EXCEPTION 'Cannot add users.user_id_normalized: existing users contain case/trim normalized user_id collisions.';
  END IF;
END $$;

CREATE TYPE "UserAccountStatus" AS ENUM ('active', 'inactive');
CREATE TYPE "RosterImportStatus" AS ENUM ('previewed', 'committed', 'failed', 'cancelled');
CREATE TYPE "StudentAccountEventType" AS ENUM (
  'student_created_manually',
  'student_created_by_roster',
  'display_name_updated',
  'access_code_reset',
  'student_deactivated',
  'student_reactivated'
);

ALTER TABLE "users"
  ADD COLUMN "user_id_normalized" TEXT,
  ADD COLUMN "account_status" "UserAccountStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deactivated_at" TIMESTAMPTZ(6),
  ADD COLUMN "credential_updated_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_login_at" TIMESTAMPTZ(6);

UPDATE "users"
SET "user_id_normalized" = lower(btrim("user_id"));

ALTER TABLE "users"
  ALTER COLUMN "user_id_normalized" SET NOT NULL;

CREATE UNIQUE INDEX "users_user_id_normalized_key" ON "users"("user_id_normalized");
CREATE INDEX "users_role_account_status_idx" ON "users"("role", "account_status");
CREATE INDEX "users_user_id_normalized_role_idx" ON "users"("user_id_normalized", "role");

CREATE TABLE "roster_import_batches" (
  "id" UUID NOT NULL,
  "batch_public_id" TEXT NOT NULL,
  "uploaded_by_user_db_id" UUID NOT NULL,
  "source_file_name" TEXT,
  "status" "RosterImportStatus" NOT NULL DEFAULT 'previewed',
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "new_student_rows" INTEGER NOT NULL DEFAULT 0,
  "existing_unchanged_rows" INTEGER NOT NULL DEFAULT 0,
  "display_name_change_rows" INTEGER NOT NULL DEFAULT 0,
  "invalid_rows" INTEGER NOT NULL DEFAULT 0,
  "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
  "role_conflict_rows" INTEGER NOT NULL DEFAULT 0,
  "committed_new_students" INTEGER NOT NULL DEFAULT 0,
  "committed_display_name_updates" INTEGER NOT NULL DEFAULT 0,
  "normalized_preview_payload" JSONB NOT NULL,
  "validation_summary" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "committed_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "roster_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "student_account_events" (
  "id" UUID NOT NULL,
  "event_public_id" TEXT NOT NULL,
  "student_user_db_id" UUID NOT NULL,
  "performed_by_user_db_id" UUID NOT NULL,
  "event_type" "StudentAccountEventType" NOT NULL,
  "roster_import_batch_db_id" UUID,
  "metadata" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_account_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roster_import_batches_batch_public_id_key" ON "roster_import_batches"("batch_public_id");
CREATE INDEX "roster_import_batches_uploaded_by_user_db_id_created_at_idx" ON "roster_import_batches"("uploaded_by_user_db_id", "created_at");
CREATE INDEX "roster_import_batches_status_created_at_idx" ON "roster_import_batches"("status", "created_at");

CREATE UNIQUE INDEX "student_account_events_event_public_id_key" ON "student_account_events"("event_public_id");
CREATE INDEX "student_account_events_student_user_db_id_created_at_idx" ON "student_account_events"("student_user_db_id", "created_at");
CREATE INDEX "student_account_events_performed_by_user_db_id_created_at_idx" ON "student_account_events"("performed_by_user_db_id", "created_at");
CREATE INDEX "student_account_events_roster_import_batch_db_id_idx" ON "student_account_events"("roster_import_batch_db_id");
CREATE INDEX "student_account_events_event_type_created_at_idx" ON "student_account_events"("event_type", "created_at");

ALTER TABLE "roster_import_batches"
  ADD CONSTRAINT "roster_import_batches_uploaded_by_user_db_id_fkey"
  FOREIGN KEY ("uploaded_by_user_db_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "student_account_events"
  ADD CONSTRAINT "student_account_events_student_user_db_id_fkey"
  FOREIGN KEY ("student_user_db_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "student_account_events"
  ADD CONSTRAINT "student_account_events_performed_by_user_db_id_fkey"
  FOREIGN KEY ("performed_by_user_db_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "student_account_events"
  ADD CONSTRAINT "student_account_events_roster_import_batch_db_id_fkey"
  FOREIGN KEY ("roster_import_batch_db_id") REFERENCES "roster_import_batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
