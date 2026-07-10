-- Phase 31N: media-enabled MCQ item metadata.
-- Stores metadata and accessible descriptions only; media binaries remain in object storage.
CREATE TYPE "ItemMediaPlacement" AS ENUM ('item_stem', 'option');
CREATE TYPE "ItemMediaType" AS ENUM ('image', 'video', 'reference_link');
CREATE TYPE "ItemMediaSourceType" AS ENUM ('uploaded', 'external_url');

CREATE TABLE "item_media_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "media_public_id" TEXT NOT NULL,
  "item_db_id" UUID NOT NULL,
  "option_label" TEXT,
  "placement" "ItemMediaPlacement" NOT NULL,
  "media_type" "ItemMediaType" NOT NULL,
  "source_type" "ItemMediaSourceType" NOT NULL,
  "storage_key" TEXT,
  "public_or_signed_url" TEXT,
  "external_url" TEXT,
  "title" TEXT,
  "alt_text_or_description" TEXT NOT NULL,
  "caption" TEXT,
  "transcript_or_content_summary" TEXT,
  "source_attribution" TEXT,
  "media_context_hash" TEXT NOT NULL,
  "order_index" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "media_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "item_media_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "item_media_assets_media_public_id_key" ON "item_media_assets"("media_public_id");
CREATE INDEX "item_media_assets_item_db_id_active_order_index_idx" ON "item_media_assets"("item_db_id", "active", "order_index");
CREATE INDEX "item_media_assets_media_type_idx" ON "item_media_assets"("media_type");
CREATE INDEX "item_media_assets_source_type_idx" ON "item_media_assets"("source_type");

ALTER TABLE "item_media_assets"
  ADD CONSTRAINT "item_media_assets_item_db_id_fkey"
  FOREIGN KEY ("item_db_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
