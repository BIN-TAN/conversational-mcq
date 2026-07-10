ALTER TABLE "item_media_assets"
  ADD COLUMN "student_alt_text" TEXT,
  ADD COLUMN "teacher_llm_media_description" TEXT;

UPDATE "item_media_assets"
SET
  "student_alt_text" = "alt_text_or_description",
  "teacher_llm_media_description" = "alt_text_or_description"
WHERE "student_alt_text" IS NULL
  OR "teacher_llm_media_description" IS NULL;
