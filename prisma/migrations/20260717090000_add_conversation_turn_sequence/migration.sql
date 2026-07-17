CREATE SEQUENCE "conversation_turns_sequence_index_seq";

ALTER TABLE "conversation_turns"
ADD COLUMN "sequence_index" INTEGER;

WITH ordered_turns AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "created_at" ASC, "id" ASC)::INTEGER AS "sequence_index"
  FROM "conversation_turns"
)
UPDATE "conversation_turns" AS target
SET "sequence_index" = ordered_turns."sequence_index"
FROM ordered_turns
WHERE target."id" = ordered_turns."id";

SELECT setval(
  'conversation_turns_sequence_index_seq',
  COALESCE((SELECT MAX("sequence_index") FROM "conversation_turns"), 0) + 1,
  false
);

ALTER TABLE "conversation_turns"
ALTER COLUMN "sequence_index" SET DEFAULT nextval('conversation_turns_sequence_index_seq'),
ALTER COLUMN "sequence_index" SET NOT NULL;

ALTER SEQUENCE "conversation_turns_sequence_index_seq"
OWNED BY "conversation_turns"."sequence_index";

CREATE UNIQUE INDEX "conversation_turns_sequence_index_key"
ON "conversation_turns"("sequence_index");

CREATE INDEX "conversation_turns_assessment_session_db_id_sequence_index_idx"
ON "conversation_turns"("assessment_session_db_id", "sequence_index");
