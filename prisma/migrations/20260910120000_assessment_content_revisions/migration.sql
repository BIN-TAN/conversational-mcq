-- Preserve administered assessment content while allowing corrected future versions.

ALTER TABLE "assessments"
ADD COLUMN "revision_family_public_id" TEXT,
ADD COLUMN "revision_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "supersedes_assessment_public_id" TEXT,
ADD COLUMN "revision_reason" TEXT,
ADD COLUMN "source_content_hash" TEXT;

ALTER TABLE "concept_units"
ADD COLUMN "supersedes_concept_unit_public_id" TEXT;

ALTER TABLE "items"
ADD COLUMN "supersedes_item_public_id" TEXT;

ALTER TABLE "item_media_assets"
ADD COLUMN "supersedes_media_public_id" TEXT;

CREATE UNIQUE INDEX "assessments_supersedes_assessment_public_id_key"
ON "assessments"("supersedes_assessment_public_id");

CREATE INDEX "assessments_revision_family_public_id_revision_number_idx"
ON "assessments"("revision_family_public_id", "revision_number");

CREATE UNIQUE INDEX "concept_units_supersedes_concept_unit_public_id_key"
ON "concept_units"("supersedes_concept_unit_public_id");

CREATE UNIQUE INDEX "items_supersedes_item_public_id_key"
ON "items"("supersedes_item_public_id");

CREATE UNIQUE INDEX "item_media_assets_supersedes_media_public_id_key"
ON "item_media_assets"("supersedes_media_public_id");
