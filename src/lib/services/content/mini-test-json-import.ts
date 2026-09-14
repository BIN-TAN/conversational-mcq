import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ContentServiceError } from "./errors";
import { parseMiniTestJson } from "./mini-test-json-contract";
import { createMcqImportReviewBatch } from "./mcq-import";
import { mergeTopicDiagnosticNoteIntoRules } from "./teacher-diagnostic-context";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

type StageInput = {
  teacher_user_db_id: string;
  source_text: string;
  source_file_name?: string | null;
  source_context?: Record<string, unknown>;
  candidate_contexts?: Array<{ source_location: string; original_source_text: string; source_metadata: Record<string, unknown> }>;
};

export async function stageMiniTestJsonImport(input: StageInput) {
  return withImportTransaction(tx => stageMiniTestDocument(tx, input));
}

export async function withImportTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    } catch (error) {
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) continue;
      throw error;
    }
  }
}

export async function stageMiniTestDocument(tx: Prisma.TransactionClient, input: StageInput) {
  let document;
  try { document = parseMiniTestJson(input.source_text); }
  catch (error) { throw new ContentServiceError("validation_failed", error instanceof Error ? error.message : "Invalid mini-test JSON.", 400); }
  const documentHash = hash(stableJson(input.source_context ? { document, source: input.source_context } : document));
  // Content-addressed, teacher-scoped identity makes retries and double clicks reuse one review.
  const assessmentPublicId = `asmt_json_${hash(`${input.teacher_user_db_id}\0${documentHash}`).slice(0, 32)}`;
  const blueprintHash = document.design ? hash(stableJson(document.design)) : null;

  const existing = await tx.assessment.findUnique({
    where: { assessment_public_id: assessmentPublicId },
    include: { _count: { select: { assessment_sessions: true } } }
  });
  if (existing) {
    if (existing.created_by_user_db_id !== input.teacher_user_db_id) throw new ContentServiceError("not_found", "Mini test not found.", 404);
    if (existing.status !== "draft" || existing._count.assessment_sessions > 0) {
      throw new ContentServiceError("conflict", "This file was already imported into a published, archived, or previously used mini test. Open that mini test in the assessment library.", 409);
    }
    const batch = await tx.mcqItemImportBatch.findFirst({ where: {
      assessment_db_id: existing.id, uploaded_by_user_db_id: input.teacher_user_db_id, source_type: "project_json"
    }, orderBy: { created_at: "asc" } });
    if (!batch) throw new ContentServiceError("conflict", "The original import review is no longer available. Open the mini test in the assessment library.", 409);
    return result(existing.assessment_public_id, batch.batch_public_id, true);
  }
  const assessment = await tx.assessment.create({ data: {
    assessment_public_id: assessmentPublicId,
    ...document.assessment,
    created_by_user_db_id: input.teacher_user_db_id,
    status: "draft", workflow_mode: "automatic", response_collection_mode: "llm_assisted"
  } });
  const design = document.design;
  const focus = document.assessment.diagnostic_focus || design?.section_summary || document.assessment.title;
  await tx.conceptUnit.create({ data: {
    assessment_db_id: assessment.id,
    title: design?.section_topic ?? document.assessment.title,
    learning_objective: design?.objectives.map(objective => objective.statement).join("\n") ?? focus,
    related_concept_description: design?.section_summary ?? focus,
    order_index: 1, status: "draft", version: 1,
    administration_rules: mergeTopicDiagnosticNoteIntoRules({
      topic_diagnostic_note: focus,
      administration_rules: {
        teacher_authoring_mode: "mini_test_primary_topic", hidden_from_standard_teacher_flow: true,
        ...(design ? { item_design_blueprint: design, item_design_blueprint_hash: blueprintHash,
          item_design_blueprint_saved_at: new Date().toISOString() } : {})
      }
    }) as Prisma.InputJsonValue
  } });
  const batch = await createMcqImportReviewBatch({
    teacher_user_db_id: input.teacher_user_db_id, assessment_db_id: assessment.id,
    data: { source_type: "project_json", source_text: input.source_text,
      source_file_name: input.source_file_name, assisted_parsing_requested: false },
    source_context: { schema_version: document.schema_version, canonical_document_hash: documentHash,
      require_confirmed_keys: true,
      assessment: document.assessment, design: design ?? null, blueprint_hash: blueprintHash, ...input.source_context },
    candidate_contexts: input.candidate_contexts
  }, tx);
  return result(assessment.assessment_public_id, batch.batch_public_id, false);
}

function result(assessmentId: string, batchId: string, reused: boolean) {
  return { assessment_public_id: assessmentId, batch_public_id: batchId, reused,
    review_url: `/teacher/content/assessments/${encodeURIComponent(assessmentId)}/import-mcq?batch=${encodeURIComponent(batchId)}` };
}
