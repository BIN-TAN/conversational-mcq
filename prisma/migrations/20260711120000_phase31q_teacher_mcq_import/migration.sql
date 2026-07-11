-- Phase 31q: teacher MCQ import preview/provenance batches.
CREATE TABLE "mcq_item_import_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_public_id" TEXT NOT NULL DEFAULT concat('cmcqimport_', replace(gen_random_uuid()::text, '-', '')),
    "assessment_db_id" UUID NOT NULL,
    "uploaded_by_user_db_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_file_name" TEXT,
    "source_checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'previewed',
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_count" INTEGER NOT NULL DEFAULT 0,
    "key_missing_count" INTEGER NOT NULL DEFAULT 0,
    "llm_suggestion_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "validation_summary" JSONB NOT NULL,
    "candidates_payload" JSONB NOT NULL,
    "suggestion_payload" JSONB,
    "import_summary" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcq_item_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcq_item_import_batches_batch_public_id_key" ON "mcq_item_import_batches"("batch_public_id");
CREATE INDEX "mcq_item_import_batches_assessment_db_id_created_at_idx" ON "mcq_item_import_batches"("assessment_db_id", "created_at");
CREATE INDEX "mcq_item_import_batches_uploaded_by_user_db_id_created_at_idx" ON "mcq_item_import_batches"("uploaded_by_user_db_id", "created_at");
CREATE INDEX "mcq_item_import_batches_status_created_at_idx" ON "mcq_item_import_batches"("status", "created_at");

ALTER TABLE "mcq_item_import_batches"
ADD CONSTRAINT "mcq_item_import_batches_assessment_db_id_fkey"
FOREIGN KEY ("assessment_db_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mcq_item_import_batches"
ADD CONSTRAINT "mcq_item_import_batches_uploaded_by_user_db_id_fkey"
FOREIGN KEY ("uploaded_by_user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
