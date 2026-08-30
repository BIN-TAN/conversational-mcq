import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import JSZip from "jszip";
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
  respondToAssessmentItemDesignAssistant,
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
  assistantCallCount = 0;
  generationCallCount = 0;
  failGenerationCalls = new Set<number>();
  omitMaterialSummaries = false;

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    this.callCount += 1;
    if (request.metadata?.purpose === "teacher_evidence_centered_blueprint_conversation") {
      this.assistantCallCount += 1;
      const assistantInput = request.input as {
        current_source_materials?: Array<{ material_id?: string; file_name?: string }>;
      };
      const output = {
        schema_version: "evidence-centered-item-design-assistant-output-v2",
        assistant_message: "I shaped the material into one section objective, an observable evidence requirement, and a misconception hypothesis. Review the wording before generating drafts.",
        blueprint_updates: [
          { update_type: "set_section_topic", value: "Sampling bias and generalization" },
          { update_type: "set_section_summary", value: "How self-selection affects conclusions about a target population." },
          {
            update_type: "upsert_objective",
            objective: {
              objective_id: "objective_1",
              statement: "Apply self-selection bias reasoning to a research scenario.",
              evidence_requirements: ["Explains how volunteers may differ systematically from the target population."]
            }
          },
          {
            update_type: "upsert_misconception",
            misconception: {
              misconception_id: "misconception_1",
              statement: "Open participation makes a volunteer sample representative.",
              linked_objective_ids: ["objective_1"],
              student_language_examples: ["Anyone could volunteer, so the sample represents everyone."],
              why_plausible: "Open access can be confused with representative selection."
            }
          },
          {
            update_type: "upsert_exemplar",
            exemplar: {
              exemplar_id: "exemplar_1",
              item_text: "A researcher recruits volunteers and generalizes the results to all students.",
              observed_difficulty_note: "Students often confuse availability with representativeness."
            }
          },
          {
            update_type: "update_generation_settings",
            settings: {
              target_item_count: 3,
              option_count: 4,
              difficulty_mix: ["foundational", "application", "reasoning"],
              context_notes: null
            }
          }
        ],
        change_summary: ["Defined the section and objective.", "Added one misconception hypothesis and exemplar."],
        remaining_questions: [],
        material_summaries: this.omitMaterialSummaries
          ? []
          : (assistantInput.current_source_materials ?? []).map((material) => ({
              material_id: material.material_id,
              summary: `Teacher course material from ${material.file_name ?? "the uploaded document"} supports the sampling-bias objective.`,
              limitations: []
            })),
        ready_for_item_generation: true
      };
      return {
        provider: "mock",
        client_request_id: request.client_request_id,
        provider_request_id: `mock_assistant_request_${this.assistantCallCount}`,
        provider_response_id: `mock_assistant_response_${this.assistantCallCount}`,
        status: "completed",
        parsed_output: output as TOutput,
        raw_output: output,
        usage: { input_tokens: 90, output_tokens: 120, total_tokens: 210 },
        latency_ms: 1
      };
    }

    this.generationCallCount += 1;
    if (this.failGenerationCalls.has(this.generationCallCount)) {
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
      provider_request_id: `mock_request_${this.generationCallCount}`,
      provider_response_id: `mock_response_${this.generationCallCount}`,
      status: "completed",
      parsed_output: output as TOutput,
      raw_output: output,
      usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
      latency_ms: 1
    };
  }
}

async function courseMaterialDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Volunteer samples may differ systematically from the broader population.</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
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
    const provider = new ItemGenerationProvider();
    const assistantClientMessageId = `assistant_message_${randomUUID()}`;
    const uploadedDocx = await courseMaterialDocx();
    const uploadedPdf = Buffer.from("%PDF-1.7\nsynthetic course source\n%%EOF", "ascii");
    const uploadedPng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("synthetic screenshot source", "ascii")
    ]);
    const uploadedFiles = [
      {
        file_name: "sampling-course-material.docx",
        media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes: uploadedDocx
      },
      {
        file_name: "sampling-reading.pdf",
        media_type: "application/pdf",
        bytes: uploadedPdf
      },
      {
        file_name: "sampling-slide.png",
        media_type: "image/png",
        bytes: uploadedPng
      }
    ];
    const saved = await withItemGenerationProviderForTest(
      { provider, provider_label: "mock" },
      () => respondToAssessmentItemDesignAssistant({
        teacher_user_db_id: teacher.id,
        assessment_public_id: assessmentPublicId!,
        data: {
          client_message_id: assistantClientMessageId,
          expected_blueprint_hash: initial.blueprint_hash,
          expected_concept_unit_version: initial.concept_unit_version,
          message: "Use this course material to design a mini test about volunteer sampling and generalization. Students should explain why volunteers can differ from the target population."
        },
        files: uploadedFiles
      })
    );
    assert(saved.blueprint.section_topic === "Sampling bias and generalization", "The assistant should update the section topic.");
    assert(saved.blueprint.objectives[0]?.evidence_requirements.length === 1, "The assistant should preserve observable evidence.");
    assert(saved.blueprint.misconception_hypotheses.length === 1, "The assistant should add a misconception hypothesis.");
    assert(saved.blueprint.exemplar_items.length === 1, "The assistant should preserve an exemplar item for review.");
    assert(saved.assistant_thread.messages.length === 2, "The persisted authoring transcript should contain one teacher-assistant exchange.");
    assert(saved.source_materials.length === 3, "All uploaded teacher course materials should be retained as normalized source evidence.");
    assert(saved.source_materials[0]?.file_name === "sampling-course-material.docx", "The source-material projection should retain the safe file name.");
    assert(saved.assistant_thread.messages[0]?.attachment_material_ids.length === 3, "The teacher turn should link all uploaded materials.");
    assert(saved.assistant_state.ready_for_item_generation, "Assistant readiness should be advisory and persisted.");

    const assistantReplay = await withItemGenerationProviderForTest(
      { provider, provider_label: "mock" },
      () => respondToAssessmentItemDesignAssistant({
        teacher_user_db_id: teacher.id,
        assessment_public_id: assessmentPublicId!,
        data: {
          client_message_id: assistantClientMessageId,
          expected_blueprint_hash: initial.blueprint_hash,
          expected_concept_unit_version: initial.concept_unit_version,
          message: "Use this course material to design a mini test about volunteer sampling and generalization. Students should explain why volunteers can differ from the target population."
        },
        files: uploadedFiles
      })
    );
    assert(assistantReplay.concept_unit_version === saved.concept_unit_version, "A stale duplicate request should replay the persisted exchange.");
    assert(assistantReplay.assistant_thread.messages.length === 2, "Idempotent replay must not duplicate authoring messages.");
    assert(provider.assistantCallCount === 1, "Idempotent authoring replay must not call the provider again.");

    provider.omitMaterialSummaries = true;
    let incompleteMaterialSummaryRejected = false;
    try {
      await withItemGenerationProviderForTest(
        { provider, provider_label: "mock" },
        () => respondToAssessmentItemDesignAssistant({
          teacher_user_db_id: teacher.id,
          assessment_public_id: assessmentPublicId!,
          data: {
            client_message_id: `missing_summary_${randomUUID()}`,
            expected_blueprint_hash: saved.blueprint_hash,
            expected_concept_unit_version: saved.concept_unit_version,
            message: "Review this additional reading."
          },
          files: [{
            file_name: "additional-reading.pdf",
            media_type: "application/pdf",
            bytes: Buffer.from("%PDF-1.7\nadditional source\n%%EOF", "ascii")
          }]
        })
      );
    } catch {
      incompleteMaterialSummaryRejected = true;
    } finally {
      provider.omitMaterialSummaries = false;
    }
    assert(incompleteMaterialSummaryRejected, "A response missing an uploaded-material summary must fail closed.");
    const afterRejectedMaterial = await getAssessmentItemDesign({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessmentPublicId
    });
    assert(afterRejectedMaterial.source_materials.length === 3, "An invalid material response must not partially persist its source.");
    assert(afterRejectedMaterial.assistant_thread.messages.length === 2, "An invalid material response must not append a partial exchange.");

    const conceptUnit = await prisma.conceptUnit.findUniqueOrThrow({
      where: { concept_unit_public_id: saved.concept_unit_public_id },
      select: { administration_rules: true }
    });
    const storedRulesText = JSON.stringify(conceptUnit.administration_rules);
    assert(storedRulesText.includes("Volunteer samples may differ systematically"), "Extracted Word text should remain in the teacher-only authoring record.");
    assert(!storedRulesText.includes(uploadedPdf.toString("base64")), "PDF binary data must not be persisted in the authoring record.");
    assert(!storedRulesText.includes(uploadedPng.toString("base64")), "Image binary data must not be persisted in the authoring record.");

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
    assert(provider.generationCallCount === 1, "Idempotent replay must not call the provider again.");

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
    provider.failGenerationCalls.add(2);
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
    assert(Number(provider.generationCallCount) === 3, "Retry coverage should include one success, one failure, and one bounded user retry.");

    const calls = await prisma.agentCall.findMany({
      where: { agent_invocation_key: { startsWith: `evidence_item_generation:${assessmentPublicId}:` } }
    });
    assert(calls.length === 3, "Each provider attempt should have a distinct persisted AgentCall.");
    assert(calls.filter((call) => call.call_status === "succeeded").length === 2, "Expected two successful generation calls.");
    assert(calls.filter((call) => call.call_status === "failed").length === 1, "Expected one preserved failed generation call.");

    const assistantCalls = await prisma.agentCall.findMany({
      where: { agent_invocation_key: { startsWith: `evidence_item_design_assistant:${assessmentPublicId}:` } }
    });
    assert(assistantCalls.length === 2, "The authoring audit should preserve the accepted call and the rejected material-summary call.");
    assert(assistantCalls.filter((call) => call.call_status === "succeeded").length === 1, "The accepted authoring AgentCall should record successful validation.");
    assert(assistantCalls.filter((call) => call.call_status === "invalid_output").length === 1, "The incomplete material summary should remain a typed invalid output.");
    assert(
      !JSON.stringify(assistantCalls[0]?.input_payload).includes(userId),
      "Teacher account identifiers must not enter the provider context."
    );
    assert(
      !JSON.stringify(assistantCalls[0]?.input_payload).includes(uploadedPdf.toString("base64")) &&
        !JSON.stringify(assistantCalls[0]?.input_payload).includes(uploadedPng.toString("base64")),
      "Binary course-material payloads must not enter the persisted AgentCall audit context."
    );

    console.log("teacher evidence-centered item design runtime smoke passed");
  } finally {
    if (assessmentPublicId) {
      const assessment = await prisma.assessment.findUnique({
        where: { assessment_public_id: assessmentPublicId },
        include: { concept_units: { select: { id: true } } }
      });
      if (assessment) {
        await prisma.agentCall.deleteMany({
          where: {
            OR: [
              { agent_invocation_key: { startsWith: `evidence_item_generation:${assessmentPublicId}:` } },
              { agent_invocation_key: { startsWith: `evidence_item_design_assistant:${assessmentPublicId}:` } }
            ]
          }
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
