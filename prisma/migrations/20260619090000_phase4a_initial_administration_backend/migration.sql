-- AlterTable
ALTER TABLE "assessment_sessions"
  ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "resume_phase" "AssessmentPhase",
  ADD COLUMN "resume_context" JSONB;

-- AlterTable
ALTER TABLE "item_responses"
  ADD COLUMN "skipped_item" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "student_action_idempotency_keys" (
  "id" UUID NOT NULL,
  "assessment_session_db_id" UUID NOT NULL,
  "client_action_id" TEXT NOT NULL,
  "action_type" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response_payload" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "student_action_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assessment_sessions_user_db_id_assessment_db_id_attempt_number_key"
  ON "assessment_sessions"("user_db_id", "assessment_db_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "student_action_idempotency_keys_assessment_session_db_id_client_action_id_key"
  ON "student_action_idempotency_keys"("assessment_session_db_id", "client_action_id");

-- CreateIndex
CREATE INDEX "student_action_idempotency_keys_assessment_session_db_id_action_type_idx"
  ON "student_action_idempotency_keys"("assessment_session_db_id", "action_type");

-- AddForeignKey
ALTER TABLE "student_action_idempotency_keys"
  ADD CONSTRAINT "student_action_idempotency_keys_assessment_session_db_id_fkey"
  FOREIGN KEY ("assessment_session_db_id") REFERENCES "assessment_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
