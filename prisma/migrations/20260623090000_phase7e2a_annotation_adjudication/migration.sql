-- Phase 7E2A annotation adjudication provenance.
-- Existing manually entered annotations remain confirmed human_manual records.
ALTER TABLE "eval_annotations"
  ADD COLUMN "confirmed_by_user_db_id" UUID,
  ADD COLUMN "annotation_source" TEXT NOT NULL DEFAULT 'human_manual',
  ADD COLUMN "annotation_status" TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN "confirmed_at" TIMESTAMPTZ(6);

UPDATE "eval_annotations"
SET
  "confirmed_by_user_db_id" = "annotated_by_user_db_id",
  "confirmed_at" = COALESCE("updated_at", "created_at")
WHERE "annotation_status" = 'confirmed'
  AND "confirmed_by_user_db_id" IS NULL;

CREATE INDEX "eval_annotations_confirmed_by_user_db_id_confirmed_at_idx"
  ON "eval_annotations"("confirmed_by_user_db_id", "confirmed_at");

CREATE INDEX "eval_annotations_annotation_source_idx"
  ON "eval_annotations"("annotation_source");

CREATE INDEX "eval_annotations_annotation_status_idx"
  ON "eval_annotations"("annotation_status");

ALTER TABLE "eval_annotations"
  ADD CONSTRAINT "eval_annotations_confirmed_by_user_db_id_fkey"
  FOREIGN KEY ("confirmed_by_user_db_id")
  REFERENCES "users"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
