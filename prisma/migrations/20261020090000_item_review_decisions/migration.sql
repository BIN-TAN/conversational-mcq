-- Instructor decisions on items flagged as a possible item issue (interpretation v8).
CREATE TYPE "ItemReviewDecisionType" AS ENUM ('kept', 'excluded');

CREATE TABLE "item_review_decisions" (
  "id" UUID NOT NULL,
  "decision_public_id" TEXT NOT NULL,
  "item_db_id" UUID NOT NULL,
  "decision" "ItemReviewDecisionType" NOT NULL,
  "note" TEXT,
  "decided_by_user_db_id" UUID NOT NULL,
  "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "superseded_at" TIMESTAMPTZ(6),
  CONSTRAINT "item_review_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "item_review_decisions_item_db_id_fkey" FOREIGN KEY ("item_db_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "item_review_decisions_decided_by_user_db_id_fkey" FOREIGN KEY ("decided_by_user_db_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "item_review_decisions_decision_public_id_key" ON "item_review_decisions"("decision_public_id");
CREATE INDEX "item_review_decisions_item_db_id_superseded_at_idx" ON "item_review_decisions"("item_db_id", "superseded_at");
