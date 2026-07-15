-- Phase 31al5: durable command-result ledger for assessment attempt lifecycle operations.
CREATE TABLE "assessment_lifecycle_operations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operation_public_id" TEXT NOT NULL,
    "command_type" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "target_assessment_public_id" TEXT,
    "target_session_public_id" TEXT,
    "request_id" TEXT,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prior_canonical_status" TEXT,
    "prior_lifecycle_version" TEXT,
    "mutation_committed" BOOLEAN NOT NULL DEFAULT false,
    "resulting_session_public_id" TEXT,
    "resulting_attempt_number" INTEGER,
    "resulting_canonical_status" TEXT,
    "already_satisfied" BOOLEAN NOT NULL DEFAULT false,
    "recovered" BOOLEAN NOT NULL DEFAULT false,
    "safe_failure_stage" TEXT,
    "safe_failure_code" TEXT,
    "http_status" INTEGER,
    "safe_response_code" TEXT,
    "response_payload" JSONB,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assessment_session_db_id" UUID,

    CONSTRAINT "assessment_lifecycle_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assessment_lifecycle_operations_operation_public_id_key" ON "assessment_lifecycle_operations"("operation_public_id");
CREATE INDEX "assessment_lifecycle_operations_command_type_requested_at_idx" ON "assessment_lifecycle_operations"("command_type", "requested_at");
CREATE INDEX "assessment_lifecycle_operations_target_assessment_public_id_idx" ON "assessment_lifecycle_operations"("target_assessment_public_id");
CREATE INDEX "assessment_lifecycle_operations_target_session_public_id_idx" ON "assessment_lifecycle_operations"("target_session_public_id");
CREATE INDEX "assessment_lifecycle_operations_assessment_session_db_id_idx" ON "assessment_lifecycle_operations"("assessment_session_db_id");

ALTER TABLE "assessment_lifecycle_operations"
  ADD CONSTRAINT "assessment_lifecycle_operations_assessment_session_db_id_fkey"
  FOREIGN KEY ("assessment_session_db_id") REFERENCES "assessment_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
