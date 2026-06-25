-- CreateTable
CREATE TABLE "operational_agent_effective_results" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "agent_call_db_id" UUID,
    "agent_name" TEXT NOT NULL,
    "operational_context_type" TEXT NOT NULL,
    "operational_context_public_id" TEXT NOT NULL,
    "invocation_key" TEXT NOT NULL,
    "effective_result_version" TEXT NOT NULL,
    "effective_validator_version" TEXT NOT NULL,
    "deterministic_guard_version" TEXT,
    "canonicalization_version" TEXT,
    "fallback_version" TEXT,
    "raw_output_status" TEXT NOT NULL,
    "raw_semantic_status" TEXT NOT NULL,
    "raw_safety_status" TEXT NOT NULL,
    "effective_semantic_status" TEXT NOT NULL,
    "effective_safety_status" TEXT NOT NULL,
    "effective_overall_status" TEXT NOT NULL,
    "effective_student_facing_usable" BOOLEAN NOT NULL DEFAULT false,
    "effective_workflow_usable" BOOLEAN NOT NULL DEFAULT false,
    "deterministic_guard_applied" BOOLEAN NOT NULL DEFAULT false,
    "canonicalization_applied" BOOLEAN NOT NULL DEFAULT false,
    "fallback_applied" BOOLEAN NOT NULL DEFAULT false,
    "effective_output_json" JSONB NOT NULL,
    "effective_actions_json" JSONB NOT NULL,
    "warnings_json" JSONB NOT NULL,
    "effective_result_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_agent_effective_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operational_agent_effective_results_public_id_key" ON "operational_agent_effective_results"("public_id");

-- CreateIndex
CREATE INDEX "operational_agent_effective_results_agent_call_db_id_idx" ON "operational_agent_effective_results"("agent_call_db_id");

-- CreateIndex
CREATE INDEX "operational_agent_effective_results_agent_name_created_at_idx" ON "operational_agent_effective_results"("agent_name", "created_at");

-- CreateIndex
CREATE INDEX "operational_agent_effective_results_operational_context_typ_idx" ON "operational_agent_effective_results"("operational_context_type", "operational_context_public_id");

-- CreateIndex
CREATE INDEX "operational_agent_effective_results_effective_overall_statu_idx" ON "operational_agent_effective_results"("effective_overall_status");

-- CreateIndex
CREATE INDEX "operational_agent_effective_results_fallback_applied_idx" ON "operational_agent_effective_results"("fallback_applied");

-- CreateIndex
CREATE UNIQUE INDEX "operational_effective_invocation_version_key" ON "operational_agent_effective_results"("invocation_key", "effective_result_version");

-- AddForeignKey
ALTER TABLE "operational_agent_effective_results" ADD CONSTRAINT "operational_agent_effective_results_agent_call_db_id_fkey" FOREIGN KEY ("agent_call_db_id") REFERENCES "agent_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
