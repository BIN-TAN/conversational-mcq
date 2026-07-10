ALTER TABLE "assessments"
  ADD COLUMN "diagnostic_focus" TEXT,
  ADD COLUMN "folder_label" TEXT,
  ADD COLUMN "folder_order_index" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "assessment_order_index" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "assessments_folder_label_idx" ON "assessments"("folder_label");
CREATE INDEX "assessments_folder_order_index_assessment_order_index_idx"
  ON "assessments"("folder_order_index", "assessment_order_index");
