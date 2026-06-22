-- CreateEnum
CREATE TYPE "ItemVerificationRunStatus" AS ENUM ('pending', 'completed', 'failed', 'stale');

-- AlterTable
ALTER TABLE "concept_units" ADD COLUMN     "latest_item_verification_run_db_id" UUID;

-- CreateTable
CREATE TABLE "item_verification_runs" (
    "id" UUID NOT NULL,
    "verification_public_id" TEXT NOT NULL,
    "concept_unit_db_id" UUID NOT NULL,
    "content_fingerprint" TEXT NOT NULL,
    "concept_unit_version" INTEGER NOT NULL,
    "status" "ItemVerificationRunStatus" NOT NULL DEFAULT 'pending',
    "verification_status" TEXT NOT NULL,
    "deterministic_validation_result" JSONB NOT NULL,
    "agent_call_db_id" UUID,
    "output_payload" JSONB,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "teacher_review_required" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_by_user_db_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "failure_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "item_verification_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_verification_runs_verification_public_id_key" ON "item_verification_runs"("verification_public_id");

-- CreateIndex
CREATE INDEX "item_verification_runs_concept_unit_db_id_created_at_idx" ON "item_verification_runs"("concept_unit_db_id", "created_at");

-- CreateIndex
CREATE INDEX "item_verification_runs_content_fingerprint_idx" ON "item_verification_runs"("content_fingerprint");

-- CreateIndex
CREATE INDEX "item_verification_runs_status_idx" ON "item_verification_runs"("status");

-- CreateIndex
CREATE INDEX "item_verification_runs_verification_status_idx" ON "item_verification_runs"("verification_status");

-- CreateIndex
CREATE INDEX "item_verification_runs_agent_call_db_id_idx" ON "item_verification_runs"("agent_call_db_id");

-- CreateIndex
CREATE INDEX "item_verification_runs_acknowledged_by_user_db_id_idx" ON "item_verification_runs"("acknowledged_by_user_db_id");

-- CreateIndex
CREATE INDEX "concept_units_latest_item_verification_run_db_id_idx" ON "concept_units"("latest_item_verification_run_db_id");

-- AddForeignKey
ALTER TABLE "concept_units" ADD CONSTRAINT "concept_units_latest_item_verification_run_db_id_fkey" FOREIGN KEY ("latest_item_verification_run_db_id") REFERENCES "item_verification_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_verification_runs" ADD CONSTRAINT "item_verification_runs_concept_unit_db_id_fkey" FOREIGN KEY ("concept_unit_db_id") REFERENCES "concept_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_verification_runs" ADD CONSTRAINT "item_verification_runs_agent_call_db_id_fkey" FOREIGN KEY ("agent_call_db_id") REFERENCES "agent_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_verification_runs" ADD CONSTRAINT "item_verification_runs_acknowledged_by_user_db_id_fkey" FOREIGN KEY ("acknowledged_by_user_db_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
