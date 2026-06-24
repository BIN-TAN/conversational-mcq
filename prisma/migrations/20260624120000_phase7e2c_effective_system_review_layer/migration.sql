-- Preserve existing annotations as raw model-output reviews, then allow a
-- second independent review layer for effective-system output.
ALTER TABLE "eval_annotations"
  ADD COLUMN "review_target" TEXT NOT NULL DEFAULT 'raw_model_output';

DROP INDEX IF EXISTS "eval_annotations_run_item_db_id_annotated_by_user_db_id_key";

CREATE UNIQUE INDEX "eval_annotations_run_item_db_id_annotated_by_user_db_id_review_target_key"
  ON "eval_annotations"("run_item_db_id", "annotated_by_user_db_id", "review_target");

CREATE INDEX "eval_annotations_review_target_idx"
  ON "eval_annotations"("review_target");

CREATE INDEX "eval_annotations_annotation_source_annotation_status_review_target_idx"
  ON "eval_annotations"("annotation_source", "annotation_status", "review_target");
