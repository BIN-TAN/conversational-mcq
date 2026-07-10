import { PrismaClient } from "@prisma/client";
import {
  assessmentInterpretationContextAuditMetadata,
  buildAssessmentInterpretationContextFromResponsePackage,
  hashAssessmentInterpretationContext
} from "../src/lib/services/student-assessment/assessment-interpretation-context";
import {
  buildAbilityEvidencePacketForSession
} from "../src/lib/services/student-assessment/ability-evidence";
import {
  buildEngagementEvidencePacketForSession
} from "../src/lib/services/student-assessment/engagement-evidence";
import {
  PROFILE_INTEGRATION_AGENT_NAME,
  buildProfileIntegrationAgentInput,
  callProfileIntegrationAgent,
  executeProfileIntegrationAgentWithProviderForTest
} from "../src/lib/services/student-assessment/profile-integration";
import type { LlmProvider, StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";
import { createFormativeValueSampleSession } from "./student-formative-value-helpers";
import { assert } from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();

class CapturingProvider implements LlmProvider {
  callCount = 0;

  constructor(private readonly output: unknown) {}

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    this.callCount += 1;
    return {
      provider: "mock",
      provider_request_id: "mock_context_propagation_request",
      provider_response_id: "mock_context_propagation_response",
      client_request_id: request.client_request_id,
      status: "completed",
      parsed_output: this.output as TOutput,
      raw_output: { id: "mock_context_propagation_response", output: this.output },
      usage: {
        input_tokens: 20,
        output_tokens: 20,
        total_tokens: 40,
        raw: { source: "mock_context_propagation_usage" }
      },
      latency_ms: 1
    };
  }
}

function serialized(value: unknown) {
  return JSON.stringify(value).toLowerCase();
}

function assertSafeAuditOnly(value: unknown) {
  const text = serialized(value);
  const forbidden = [
    "harder item sets automatically",
    "item difficulty directly",
    "target_reasoning_note",
    "strong_reasoning_should_mention",
    "plain_language_distractor_diagnostic_notes",
    "selected options are indirect evidence only"
  ];

  for (const term of forbidden) {
    assert(!text.includes(term), `Context audit metadata leaked raw diagnostic note content: ${term}`);
  }
}

async function main() {
  const sample = await createFormativeValueSampleSession(prisma);

  try {
    const responsePackage = await prisma.responsePackage.findFirstOrThrow({
      where: {
        package_type: "initial_concept_unit_response_package",
        concept_unit_session: {
          assessment_session: {
            session_public_id: sample.session_public_id
          }
        }
      },
      orderBy: [{ created_at: "desc" }],
      select: { payload: true }
    });
    const context = buildAssessmentInterpretationContextFromResponsePackage({
      response_package_payload: responsePackage.payload,
      phase: "post_initial_interpretation"
    });
    const audit = assessmentInterpretationContextAuditMetadata(context);

    assert(context.schema_version === "assessment-interpretation-context-v1", "Unexpected context schema version.");
    assert(Boolean(context.assessment.diagnostic_focus), "Assessment diagnostic focus was missing.");
    assert(context.items.length === 3, "Initial response package should provide three administered items.");
    assert(
      context.items.every((item) => item.stem && Array.isArray(item.visible_options)),
      "Every context item should include stem and visible options."
    );
    assert(
      context.items.every((item) => item.correct_option_internal),
      "Internal correct options should be available only in backend/provider context."
    );
    assert(
      context.items.some((item) => item.target_reasoning_note),
      "Target reasoning note did not reach the shared context."
    );
    assert(
      context.items.some((item) => item.strong_reasoning_should_mention),
      "Strong-reasoning guidance did not reach the shared context."
    );
    assert(
      context.items.some((item) => item.plain_language_distractor_diagnostic_notes),
      "Plain-language distractor notes did not reach the shared context."
    );
    assert(
      context.items.some((item) => item.interpretation_caution),
      "Interpretation caution did not reach the shared context."
    );
    assert(
      context.teacher_diagnostic_guidance.guidance_not_ground_truth,
      "Teacher guidance must be explicitly marked as guidance, not ground truth."
    );
    assert(
      context.observed_student_evidence.item_responses.length === 3,
      "Observed student evidence should contain the three item responses."
    );
    assert(
      context.interpretation_rules.selected_option_is_indirect_evidence_only,
      "Selected option must be marked as indirect evidence."
    );
    assert(
      context.interpretation_rules.alternative_explanations_required,
      "Alternative explanations must be required by the contract."
    );
    assert(audit.teacher_diagnostic_context_present, "Audit should record diagnostic-context presence.");
    assert(audit.target_reasoning_present, "Audit should record target-reasoning presence.");
    assert(audit.distractor_notes_present, "Audit should record distractor-note presence.");
    assert(audit.interpretation_caution_present, "Audit should record interpretation-caution presence.");
    assert(audit.student_evidence_present, "Audit should record student-evidence presence.");
    assert(audit.context_version_bound, "Audit should mark context as version-bound.");
    assert(audit.answer_key_internal_only, "Audit should mark answer key as internal only.");
    assert(audit.student_visible_protected_content_exposed === false, "Audit should not expose protected content.");
    assertSafeAuditOnly(audit);
    assert(
      !serialized(context).includes("strong_distractor_linked_misconception"),
      "Context contract should not introduce a deterministic final misconception classification."
    );

    const originalHash = hashAssessmentInterpretationContext(context);
    const firstItemPublicId = context.items[0]?.item_public_id;
    assert(firstItemPublicId, "Context should include a first item.");
    const currentItem = await prisma.item.findUniqueOrThrow({
      where: { item_public_id: firstItemPublicId },
      select: { item_stem: true }
    });
    await prisma.item.update({
      where: { item_public_id: firstItemPublicId },
      data: { item_stem: `${currentItem.item_stem}\n\nDraft edit after session start.` }
    });
    try {
      const contextAfterDraftEdit = buildAssessmentInterpretationContextFromResponsePackage({
        response_package_payload: responsePackage.payload,
        phase: "post_initial_interpretation"
      });
      assert(
        hashAssessmentInterpretationContext(contextAfterDraftEdit) === originalHash,
        "Context built from the administered response package should not drift after a draft item edit."
      );
    } finally {
      await prisma.item.update({
        where: { item_public_id: firstItemPublicId },
        data: { item_stem: currentItem.item_stem }
      });
    }

    const [abilityPacket, engagementPacket] = await Promise.all([
      buildAbilityEvidencePacketForSession(sample.session_public_id),
      buildEngagementEvidencePacketForSession(sample.session_public_id)
    ]);
    const agentInput = buildProfileIntegrationAgentInput({
      ability_packet: abilityPacket,
      engagement_packet: engagementPacket,
      assessment_interpretation_context: context
    });

    assert(
      agentInput.assessment_interpretation_context?.schema_version ===
        "assessment-interpretation-context-v1",
      "Profile integration input did not receive the shared context."
    );
    assert(
      agentInput.assessment_context_audit?.assessment_context_hash === audit.assessment_context_hash,
      "Profile integration audit hash should match the context hash."
    );

    const output = await callProfileIntegrationAgent(agentInput);
    const provider = new CapturingProvider(output);
    const result = await executeProfileIntegrationAgentWithProviderForTest({
      agent_input: agentInput,
      provider
    });
    assert(result.status === "succeeded", "Mock provider profile integration should succeed.");
    assert(provider.callCount === 1, "Smoke should use exactly one mock provider call.");
    assert(result.agent_call_id, "Agent call ID should be returned.");

    const agentCall = await prisma.agentCall.findUniqueOrThrow({
      where: { id: result.agent_call_id },
      select: {
        agent_name: true,
        input_payload: true,
        provider: true,
        provider_request_id: true,
        provider_response_id: true
      }
    });
    const payload = agentCall.input_payload as Record<string, unknown>;
    assert(agentCall.agent_name === PROFILE_INTEGRATION_AGENT_NAME, "Unexpected agent name.");
    assert(agentCall.provider === "mock", "No OpenAI provider should be called.");
    assert(agentCall.provider_request_id === "mock_context_propagation_request", "Mock request ID should persist.");
    assert(agentCall.provider_response_id === "mock_context_propagation_response", "Mock response ID should persist.");
    assert(Boolean(payload.assessment_interpretation_context), "Persisted input payload should include context.");
    assert(Boolean(payload.assessment_context_audit), "Persisted input payload should include context audit metadata.");
    assertSafeAuditOnly(payload.assessment_context_audit);

    console.log(JSON.stringify({
      status: "passed",
      session_public_id: sample.session_public_id,
      context_schema_version: context.schema_version,
      context_hash: audit.assessment_context_hash,
      administered_item_count: context.items.length,
      openai_calls: 0
    }, null, 2));
  } finally {
    await sample.cleanup();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect();
  console.error(error);
  process.exit(1);
});
