-- CreateTable
CREATE TABLE "eval_annotation_revisions" (
    "id" UUID NOT NULL,
    "revision_public_id" TEXT NOT NULL,
    "annotation_db_id" UUID NOT NULL,
    "run_item_db_id" UUID NOT NULL,
    "amended_by_user_db_id" UUID NOT NULL,
    "amendment_source" TEXT NOT NULL,
    "amendment_reason" TEXT NOT NULL,
    "previous_annotation_snapshot" JSONB NOT NULL,
    "new_annotation_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_annotation_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "eval_annotation_revisions_revision_public_id_key" ON "eval_annotation_revisions"("revision_public_id");

-- CreateIndex
CREATE INDEX "eval_annotation_revisions_annotation_db_id_created_at_idx" ON "eval_annotation_revisions"("annotation_db_id", "created_at");

-- CreateIndex
CREATE INDEX "eval_annotation_revisions_run_item_db_id_created_at_idx" ON "eval_annotation_revisions"("run_item_db_id", "created_at");

-- CreateIndex
CREATE INDEX "eval_annotation_revisions_amended_by_user_db_id_created_at_idx" ON "eval_annotation_revisions"("amended_by_user_db_id", "created_at");

-- CreateIndex
CREATE INDEX "eval_annotation_revisions_amendment_source_idx" ON "eval_annotation_revisions"("amendment_source");

-- AddForeignKey
ALTER TABLE "eval_annotation_revisions" ADD CONSTRAINT "eval_annotation_revisions_annotation_db_id_fkey" FOREIGN KEY ("annotation_db_id") REFERENCES "eval_annotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_annotation_revisions" ADD CONSTRAINT "eval_annotation_revisions_run_item_db_id_fkey" FOREIGN KEY ("run_item_db_id") REFERENCES "eval_run_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_annotation_revisions" ADD CONSTRAINT "eval_annotation_revisions_amended_by_user_db_id_fkey" FOREIGN KEY ("amended_by_user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
