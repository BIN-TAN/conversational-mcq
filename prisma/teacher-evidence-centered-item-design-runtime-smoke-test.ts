import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";
import { createAssessment } from "../src/lib/services/content/assessments";
import {
  generateAssessmentItemDrafts,
  getAssessmentItemDesign,
  saveAssessmentItemDesign,
  withItemGenerationProviderForTest
} from "../src/lib/services/content/item-design";
import { getMcqItemImportBatch } from "../src/lib/services/content/mcq-import";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function generatedOutput(itemCount: number) {
  return {
    schema_version: "evidence-centered-mcq-generation-output-v1",
    blueprint_version: "evidence-centered-item-design-v1",
    candidates: Array.from({ length: itemCount }, (_, index) => ({
      item_label: `Generated item ${index + 1}`,
      stem: `Which response best demonstrates objective 1 in situation ${index + 1}?`,
      options: [
        { label: "A", text: "Applies the objective with relevant reasoning.", rationale: "This is the proposed answer.", linked_misconception_ids: [] },
        { label: "B", text: "Uses an unrelated rule.", rationale: "This does not address the objective.", linked_misconception_ids: ["misconception_1"] },
        { label: "C", text: "Repeats a term without applying it.", rationale: "This provides insufficient evidence.", linked_misconception_ids: [] },
        { label: "D", text: "Draws a conclusion from missing evidence.", rationale: "This conclusion is unsupported.", linked_misconception_ids: [] }
      ],
      proposed_correct_option: "A",
      correct_answer_explanation: "Option A applies the objective and explains the relevant evidence.",
      objective_ids: ["objective_1"],
      misconception_hypothesis_ids: ["misconception_1"],
      target_reasoning_note: "The response should apply the objective to the situation.",
      strong_reasoning_should_mention: "Explain why the evidence supports the conclusion.",
      cognitive_demand: "apply",
      difficulty: index % 2 === 0 ? "application" : "reasoning",
      limitations: ["Teacher review and key confirmation are required."]
    })),
    coverage_summary: [{ objective_id: "objective_1", candidate_count: itemCount }],
    set_level_limitations: ["Draft wording may require course-specific revision."],
    teacher_review_required: true
  };
}

class ItemGenerationProvider implements LlmProvider {
  callCount = 0;
  failCalls = new Set<number>();

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    this.callCount += 1;
    if (this.failCalls.has(this.callCount)) {
      return {
        provider: "mock",
        client_request_id: request.client_request_id,
        status: "failed",
        latency_ms: 1,
        error: { category: "network", message: "Injected failure.", retryable: true }
      };
    }
    const input = request.input as { blueprint?: { generation_settings?: { target_item_count?: number } } };
    const output = generatedOutput(input.blueprint?.generation_settings?.target_item_count ?? 3);
    return {
      provider: "mock",
      client_request_id: request.client_request_id,
      provider_request_id: `mock_request_${this.callCount}`,
      provider_response_id: `mock_response_${this.callCount}`,
      status: "completed",
      parsed_output: output as TOutput,
      raw_output: output,
      usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
      latency_ms: 1
    };
  }
}

async function main() {
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
  const userId = `item_design_teacher_${suffix}`;
  const teacher = await prisma.user.create({
    data: {
      user_id: userId,
      user_id_normalized: normalizeUserId(userId),
      role: "teacher_researcher",
      password_hash: await hashSecret(randomUUID())
    }
  });
  let assessmentPublicId: string | null = null;

  try {
    const assessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `Evidence-centered authoring ${suffix}`,
        diagnostic_focus: "Apply a section-level objective and explain the supporting evidence.",
        folder_label: "Authoring smoke",
        workflow_mode: "automatic",
        response_collection_mode: "llm_assisted",
        auto_create_primary_topic: true
      }
    });
    assessmentPublicId = assessment.assessment_public_id;

    const initial = await getAssessmentItemDesign({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessmentPublicId
    });
    const saved = await saveAssessmentItemDesign({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessmentPublicId,
      data: {
        expected_concept_unit_version: initial.concept_unit_version,
        blueprint: {
          ...initial.blueprint,
          objectives: [{
            objective_id: "objective_1",
            statement: "Apply the section concept to a new situation.",
            evidence_requirements: ["Select a relevant conclusion.", "Explain why the evidence supports it."]
          }],
          misconception_hypotheses: [{
            misconception_id: "misconception_1",
            statement: "Any familiar rule can justify the conclusion.",
            linked_objective_ids: ["objective_1"],
            student_language_examples: ["I used the rule because I recognized it."],
            why_plausible: "The rule appears in the same section."
          }],
          generation_settings: {
            ...initial.blueprint.generation_settings,
            target_item_count: 3,
            option_count: 4
          }
        }
      }
    });

    const provider = new ItemGenerationProvider();
    const first = await withItemGenerationProviderForTest(
      { provider, provider_label: "mock" },
      () => generateAssessmentItemDrafts({
        teacher_user_db_id: teacher.id,
        assessment_public_id: assessmentPublicId!,
        data: { expected_blueprint_hash: saved.blueprint_hash, mode: "live" }
      })
    );
    const review = await getMcqItemImportBatch({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessmentPublicId,
      batch_public_id: first.batch_public_id
    });
    assert(review.batch.candidates.length === 3, "Expected all generated drafts in the review batch.");
    assert(
      review.batch.candidates.every((candidate) => candidate.status === "needs_key"),
      "Generated candidates must require teacher key confirmation."
    );
    assert(
      review.batch.candidates.every((candidate) => candidate.teacher_confirmed_key === null),
      "A proposed key must not become an authoritative teacher key."
    );

    const replay = await withItemGenerationProviderForTest(
      { provider, provider_label: "mock" },
      () => generateAssessmentItemDrafts({
        teacher_user_db_id: teacher.id,
        assessment_public_id: assessmentPublicId!,
        data: { expected_blueprint_hash: saved.blueprint_hash, mode: "live" }
      })
    );
    assert(replay.batch_public_id === first.batch_public_id, "Duplicate generation should replay the existing review batch.");
    assert(provider.callCount === 1, "Idempotent replay must not call the provider again.");

    const revised = await saveAssessmentItemDesign({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessmentPublicId,
      data: {
        expected_concept_unit_version: saved.concept_unit_version,
        blueprint: {
          ...saved.blueprint,
          generation_settings: {
            ...saved.blueprint.generation_settings,
            context_notes: "Use a different course context for retry coverage."
          }
        }
      }
    });
    provider.failCalls.add(2);
    let failed = false;
    try {
      await withItemGenerationProviderForTest(
        { provider, provider_label: "mock" },
        () => generateAssessmentItemDrafts({
          teacher_user_db_id: teacher.id,
          assessment_public_id: assessmentPublicId!,
          data: { expected_blueprint_hash: revised.blueprint_hash, mode: "live" }
        })
      );
    } catch {
      failed = true;
    }
    assert(failed, "Injected provider failure should fail without creating a review batch.");

    const retried = await withItemGenerationProviderForTest(
      { provider, provider_label: "mock" },
      () => generateAssessmentItemDrafts({
        teacher_user_db_id: teacher.id,
        assessment_public_id: assessmentPublicId!,
        data: { expected_blueprint_hash: revised.blueprint_hash, mode: "live" }
      })
    );
    assert(Boolean(retried.batch_public_id), "A failed generation should be retryable for the unchanged blueprint.");
    assert(Number(provider.callCount) === 3, "Retry coverage should include one success, one failure, and one bounded user retry.");

    const calls = await prisma.agentCall.findMany({
      where: { agent_invocation_key: { startsWith: `evidence_item_generation:${assessmentPublicId}:` } }
    });
    assert(calls.length === 3, "Each provider attempt should have a distinct persisted AgentCall.");
    assert(calls.filter((call) => call.call_status === "succeeded").length === 2, "Expected two successful generation calls.");
    assert(calls.filter((call) => call.call_status === "failed").length === 1, "Expected one preserved failed generation call.");

    console.log("teacher evidence-centered item design runtime smoke passed");
  } finally {
    if (assessmentPublicId) {
      const assessment = await prisma.assessment.findUnique({
        where: { assessment_public_id: assessmentPublicId },
        include: { concept_units: { select: { id: true } } }
      });
      if (assessment) {
        await prisma.agentCall.deleteMany({
          where: { agent_invocation_key: { startsWith: `evidence_item_generation:${assessmentPublicId}:` } }
        });
        await prisma.mcqItemImportBatch.deleteMany({ where: { assessment_db_id: assessment.id } });
        await prisma.item.deleteMany({
          where: { concept_unit_db_id: { in: assessment.concept_units.map((unit) => unit.id) } }
        });
        await prisma.conceptUnit.deleteMany({ where: { assessment_db_id: assessment.id } });
        await prisma.assessment.delete({ where: { id: assessment.id } });
      }
    }
    await prisma.user.deleteMany({ where: { id: teacher.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
