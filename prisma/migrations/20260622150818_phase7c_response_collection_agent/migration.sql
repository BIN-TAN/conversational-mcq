-- CreateEnum
CREATE TYPE "ResponseCollectionMode" AS ENUM ('deterministic', 'llm_assisted');

-- AlterTable
ALTER TABLE "assessment_sessions" ADD COLUMN     "response_collection_mode_snapshot" "ResponseCollectionMode" NOT NULL DEFAULT 'deterministic';

-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "response_collection_mode" "ResponseCollectionMode" NOT NULL DEFAULT 'llm_assisted';

-- CreateIndex
CREATE INDEX "assessment_sessions_response_collection_mode_snapshot_curre_idx" ON "assessment_sessions"("response_collection_mode_snapshot", "current_phase");

-- CreateIndex
CREATE INDEX "assessments_response_collection_mode_idx" ON "assessments"("response_collection_mode");
