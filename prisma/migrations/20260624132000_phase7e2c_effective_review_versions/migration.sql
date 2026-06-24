-- Version each annotation review layer so v1 effective-system annotations can
-- coexist with pending or future v2 effective-system annotations.
ALTER TABLE "eval_annotations"
  ADD COLUMN "review_artifact_version" TEXT NOT NULL DEFAULT 'raw-model-output';

UPDATE "eval_annotations"
SET "review_artifact_version" = 'effective-system-eval-v1'
WHERE "review_target" = 'effective_system_output';

DROP INDEX IF EXISTS "eval_annotations_run_item_db_id_annotated_by_user_db_id_review_target_key";
DROP INDEX IF EXISTS "eval_annotations_annotation_source_annotation_status_idx";
DROP INDEX IF EXISTS "eval_annotations_annotation_source_annotation_status_review_target_idx";

CREATE UNIQUE INDEX "eval_annotations_run_user_target_version_key"
  ON "eval_annotations"("run_item_db_id", "annotated_by_user_db_id", "review_target", "review_artifact_version");

CREATE INDEX "eval_annotations_source_status_idx"
  ON "eval_annotations"("annotation_source", "annotation_status");

CREATE INDEX "eval_annotations_source_status_target_idx"
  ON "eval_annotations"("annotation_source", "annotation_status", "review_target");

CREATE INDEX "eval_annotations_review_artifact_version_idx"
  ON "eval_annotations"("review_artifact_version");

CREATE INDEX "eval_annotations_source_status_target_version_idx"
  ON "eval_annotations"("annotation_source", "annotation_status", "review_target", "review_artifact_version");
