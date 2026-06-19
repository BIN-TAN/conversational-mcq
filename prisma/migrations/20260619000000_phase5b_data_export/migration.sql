-- Phase 5B: summative outcome imports, auditable outcome revisions, and local master CSV export jobs.

-- CreateEnum
CREATE TYPE "SummativeOutcomeImportStatus" AS ENUM ('previewed', 'committed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "SummativeOutcomeRecordStatus" AS ENUM ('active', 'superseded');

-- Replace ExportJobStatus with the Phase 5B status set while preserving legacy values.
ALTER TYPE "ExportJobStatus" RENAME TO "ExportJobStatus_old";
CREATE TYPE "ExportJobStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'expired');
ALTER TABLE "export_jobs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "export_jobs"
  ALTER COLUMN "status" TYPE "ExportJobStatus"
  USING (
    CASE "status"::text
      WHEN 'requested' THEN 'pending'
      WHEN 'running' THEN 'processing'
      ELSE "status"::text
    END
  )::"ExportJobStatus";
ALTER TABLE "export_jobs" ALTER COLUMN "status" SET DEFAULT 'pending';
DROP TYPE "ExportJobStatus_old";

-- CreateTable
CREATE TABLE "summative_outcome_import_batches" (
  "id" UUID NOT NULL,
  "batch_public_id" TEXT NOT NULL,
  "uploaded_by_user_db_id" UUID NOT NULL,
  "source_file_name" TEXT,
  "status" "SummativeOutcomeImportStatus" NOT NULL DEFAULT 'previewed',
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "valid_rows" INTEGER NOT NULL DEFAULT 0,
  "invalid_rows" INTEGER NOT NULL DEFAULT 0,
  "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
  "conflicting_rows" INTEGER NOT NULL DEFAULT 0,
  "unmatched_user_rows" INTEGER NOT NULL DEFAULT 0,
  "committed_rows" INTEGER NOT NULL DEFAULT 0,
  "validation_summary" JSONB NOT NULL,
  "normalized_rows" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "committed_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "summative_outcome_import_batches_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "summative_outcomes"
  ADD COLUMN "outcome_public_id" TEXT,
  ADD COLUMN "import_batch_db_id" UUID,
  ADD COLUMN "source_row_number" INTEGER,
  ADD COLUMN "record_status" "SummativeOutcomeRecordStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "revision_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "supersedes_outcome_db_id" UUID;

UPDATE "summative_outcomes"
SET "outcome_public_id" = 'outcome_' || substr(md5("id"::text), 1, 24)
WHERE "outcome_public_id" IS NULL;

ALTER TABLE "summative_outcomes"
  ALTER COLUMN "outcome_public_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "export_jobs"
  ADD COLUMN "export_public_id" TEXT,
  ADD COLUMN "storage_key" TEXT,
  ADD COLUMN "options" JSONB,
  ADD COLUMN "export_schema_version" TEXT,
  ADD COLUMN "expires_at" TIMESTAMPTZ(6);

UPDATE "export_jobs"
SET "export_public_id" = 'export_' || substr(md5("id"::text), 1, 24)
WHERE "export_public_id" IS NULL;

ALTER TABLE "export_jobs"
  ALTER COLUMN "export_public_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "summative_outcome_import_batches_batch_public_id_key" ON "summative_outcome_import_batches"("batch_public_id");

-- CreateIndex
CREATE INDEX "summative_outcome_import_batches_uploaded_by_user_db_id_created_at_idx" ON "summative_outcome_import_batches"("uploaded_by_user_db_id", "created_at");

-- CreateIndex
CREATE INDEX "summative_outcome_import_batches_status_idx" ON "summative_outcome_import_batches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "summative_outcomes_outcome_public_id_key" ON "summative_outcomes"("outcome_public_id");

-- CreateIndex
CREATE INDEX "summative_outcomes_import_batch_db_id_idx" ON "summative_outcomes"("import_batch_db_id");

-- CreateIndex
CREATE INDEX "summative_outcomes_user_db_id_outcome_name_assessment_date_record_status_idx" ON "summative_outcomes"("user_db_id", "outcome_name", "assessment_date", "record_status");

-- CreateIndex
CREATE UNIQUE INDEX "summative_outcomes_active_logical_key" ON "summative_outcomes"("user_db_id", "outcome_name", "assessment_date") WHERE "record_status" = 'active';

-- CreateIndex
CREATE INDEX "summative_outcomes_supersedes_outcome_db_id_idx" ON "summative_outcomes"("supersedes_outcome_db_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_export_public_id_key" ON "export_jobs"("export_public_id");

-- CreateIndex
CREATE INDEX "export_jobs_expires_at_idx" ON "export_jobs"("expires_at");

-- AddForeignKey
ALTER TABLE "summative_outcome_import_batches" ADD CONSTRAINT "summative_outcome_import_batches_uploaded_by_user_db_id_fkey" FOREIGN KEY ("uploaded_by_user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summative_outcomes" ADD CONSTRAINT "summative_outcomes_import_batch_db_id_fkey" FOREIGN KEY ("import_batch_db_id") REFERENCES "summative_outcome_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summative_outcomes" ADD CONSTRAINT "summative_outcomes_supersedes_outcome_db_id_fkey" FOREIGN KEY ("supersedes_outcome_db_id") REFERENCES "summative_outcomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
