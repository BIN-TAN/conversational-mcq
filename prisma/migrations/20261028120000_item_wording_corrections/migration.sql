-- Wording fixes made to an item after students started its mini test. The item keeps its
-- identity and version; each row records what changed, why, and how many answers existed.
CREATE TABLE "item_wording_corrections" (
  "id" UUID NOT NULL,
  "correction_public_id" TEXT NOT NULL,
  "item_db_id" UUID NOT NULL,
  "corrected_by_user_db_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "changed_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "before_content" JSONB NOT NULL,
  "after_content" JSONB NOT NULL,
  "item_version" INTEGER NOT NULL,
  "responses_before" INTEGER NOT NULL,
  "sessions_before" INTEGER NOT NULL,
  "corrected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "item_wording_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "item_wording_corrections_item_db_id_fkey" FOREIGN KEY ("item_db_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "item_wording_corrections_corrected_by_user_db_id_fkey" FOREIGN KEY ("corrected_by_user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "item_wording_corrections_correction_public_id_key" ON "item_wording_corrections"("correction_public_id");
CREATE INDEX "item_wording_corrections_item_db_id_corrected_at_idx" ON "item_wording_corrections"("item_db_id", "corrected_at");
