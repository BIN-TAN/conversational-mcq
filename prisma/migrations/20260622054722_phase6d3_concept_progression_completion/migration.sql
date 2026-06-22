-- CreateEnum
CREATE TYPE "FollowupUpdatePostCycleAction" AS ENUM ('none', 'advance_to_next_concept', 'complete_assessment');

-- CreateEnum
CREATE TYPE "ConceptProgressionType" AS ENUM ('next_concept', 'complete_assessment');

-- CreateEnum
CREATE TYPE "ConceptProgressionTriggerType" AS ENUM ('robust_profile', 'agent_move_on_offer', 'student_move_on_request', 'student_explicit_button');

-- CreateEnum
CREATE TYPE "ConceptProgressionStudentChoice" AS ENUM ('continue_current_concept', 'next_concept', 'stay_in_final_concept', 'complete_assessment');

-- CreateEnum
CREATE TYPE "ConceptProgressionStatus" AS ENUM ('offered', 'final_update_pending', 'evaluating_resolution', 'awaiting_unresolved_confirmation', 'progressing', 'completed', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "ConceptProgressionResolutionStatus" AS ENUM ('resolved', 'unresolved', 'unknown');

-- AlterEnum
ALTER TYPE "FollowupUpdateTriggerType" ADD VALUE 'student_progression_final_update';

-- AlterEnum
ALTER TYPE "WorkflowJobType" ADD VALUE 'finalize_concept_progression';

-- AlterTable
ALTER TABLE "followup_update_cycles" ADD COLUMN     "post_cycle_action" "FollowupUpdatePostCycleAction" NOT NULL DEFAULT 'none',
ADD COLUMN     "progression_record_db_id" UUID;

-- CreateTable
CREATE TABLE "concept_progression_records" (
    "id" UUID NOT NULL,
    "progression_public_id" TEXT NOT NULL,
    "assessment_session_db_id" UUID NOT NULL,
    "source_concept_unit_session_db_id" UUID NOT NULL,
    "destination_concept_unit_db_id" UUID,
    "source_student_profile_db_id" UUID,
    "source_formative_decision_db_id" UUID,
    "final_update_cycle_db_id" UUID,
    "progression_type" "ConceptProgressionType" NOT NULL,
    "trigger_type" "ConceptProgressionTriggerType" NOT NULL,
    "student_choice" "ConceptProgressionStudentChoice",
    "status" "ConceptProgressionStatus" NOT NULL DEFAULT 'offered',
    "resolution_status" "ConceptProgressionResolutionStatus" NOT NULL DEFAULT 'unknown',
    "moved_on_with_unresolved_evidence" BOOLEAN NOT NULL DEFAULT false,
    "completed_with_unresolved_evidence" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "concept_progression_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "concept_progression_records_progression_public_id_key" ON "concept_progression_records"("progression_public_id");

-- CreateIndex
CREATE UNIQUE INDEX "concept_progression_records_final_update_cycle_db_id_key" ON "concept_progression_records"("final_update_cycle_db_id");

-- CreateIndex
CREATE UNIQUE INDEX "concept_progression_records_idempotency_key_key" ON "concept_progression_records"("idempotency_key");

-- CreateIndex
CREATE INDEX "concept_progression_records_assessment_session_db_id_reques_idx" ON "concept_progression_records"("assessment_session_db_id", "requested_at");

-- CreateIndex
CREATE INDEX "concept_progression_records_source_concept_unit_session_db__idx" ON "concept_progression_records"("source_concept_unit_session_db_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "concept_progression_records_one_active_per_concept_unit_idx" ON "concept_progression_records"("source_concept_unit_session_db_id")
WHERE "status" IN ('offered', 'final_update_pending', 'evaluating_resolution', 'awaiting_unresolved_confirmation', 'progressing');

-- CreateIndex
CREATE INDEX "concept_progression_records_destination_concept_unit_db_id_idx" ON "concept_progression_records"("destination_concept_unit_db_id");

-- CreateIndex
CREATE INDEX "concept_progression_records_source_student_profile_db_id_idx" ON "concept_progression_records"("source_student_profile_db_id");

-- CreateIndex
CREATE INDEX "concept_progression_records_source_formative_decision_db_id_idx" ON "concept_progression_records"("source_formative_decision_db_id");

-- CreateIndex
CREATE INDEX "concept_progression_records_progression_type_status_idx" ON "concept_progression_records"("progression_type", "status");

-- CreateIndex
CREATE INDEX "followup_update_cycles_progression_record_db_id_idx" ON "followup_update_cycles"("progression_record_db_id");

-- AddForeignKey
ALTER TABLE "followup_update_cycles" ADD CONSTRAINT "followup_update_cycles_progression_record_db_id_fkey" FOREIGN KEY ("progression_record_db_id") REFERENCES "concept_progression_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_progression_records" ADD CONSTRAINT "concept_progression_records_assessment_session_db_id_fkey" FOREIGN KEY ("assessment_session_db_id") REFERENCES "assessment_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_progression_records" ADD CONSTRAINT "concept_progression_records_source_concept_unit_session_db_fkey" FOREIGN KEY ("source_concept_unit_session_db_id") REFERENCES "concept_unit_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_progression_records" ADD CONSTRAINT "concept_progression_records_destination_concept_unit_db_id_fkey" FOREIGN KEY ("destination_concept_unit_db_id") REFERENCES "concept_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_progression_records" ADD CONSTRAINT "concept_progression_records_source_student_profile_db_id_fkey" FOREIGN KEY ("source_student_profile_db_id") REFERENCES "student_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_progression_records" ADD CONSTRAINT "concept_progression_records_source_formative_decision_db_i_fkey" FOREIGN KEY ("source_formative_decision_db_id") REFERENCES "formative_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_progression_records" ADD CONSTRAINT "concept_progression_records_final_update_cycle_db_id_fkey" FOREIGN KEY ("final_update_cycle_db_id") REFERENCES "followup_update_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
