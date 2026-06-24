-- AlterTable
ALTER TABLE "eval_annotations"
  ADD COLUMN "reviewer_model" TEXT,
  ADD COLUMN "review_method" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(6),
  ADD COLUMN "annotation_file_hash" TEXT,
  ADD COLUMN "reference_file_hash" TEXT,
  ADD COLUMN "source_run_public_id" TEXT,
  ADD COLUMN "import_command_version" TEXT;

-- CreateIndex
CREATE INDEX "eval_annotations_annotation_source_annotation_status_idx"
  ON "eval_annotations"("annotation_source", "annotation_status");

-- CreateIndex
CREATE INDEX "eval_annotations_source_run_public_id_idx"
  ON "eval_annotations"("source_run_public_id");
