ALTER TABLE "item_responses"
  ADD COLUMN "answer_explanation_revealed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "revealed_at" TIMESTAMPTZ(6),
  ADD COLUMN "reveal_trigger" TEXT,
  ADD COLUMN "explanation_version" TEXT,
  ADD COLUMN "student_display_acknowledged_at" TIMESTAMPTZ(6);
