import { strict as assert } from "node:assert";
import { emptyCanonicalMisconceptionClaimCatalog } from "../src/lib/domain/misconception-claim-identity";
import {
  PROVIDER_INPUT_IDENTITY_MINIMIZATION_VERSION,
  ProviderInputPrivacyError,
  assertNoRawStudentIdentifiersInProviderPayload,
  findRawStudentIdentifierFields
} from "../src/lib/llm/provider-input-privacy";
import type { StructuredAgentRequest } from "../src/lib/llm/providers/types";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_AGENT_NAME,
  FORMATIVE_CONVERSATION_ASSESSMENT_SPECIFICATION_VERSION,
  FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
  FormativeConversationAgentInputSchema,
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_SAFE_INVALID_OUTPUT_EVIDENCE_VERSION,
  FormativeConversationLogicalGenerationAuditSchema,
  buildFormativeConversationSemanticRegenerationRequest
} from "../src/lib/services/student-assessment/formative-conversation/semantic-regeneration";
import {
  FORMATIVE_CONVERSATION_TEACHER_GUIDANCE_BOUNDARY_VERSION,
  normalizeInstructionalTeacherGuidance
} from "../src/lib/services/student-assessment/formative-conversation/teacher-guidance-boundary";
import {
  buildExportSourceIdentity,
  privacySafeStudentArtifactSegment
} from "../src/lib/services/teacher-research-export/source-identity";
import { researchStudentId } from "../src/lib/services/teacher-research-data/pseudonymization";

const rawStudentId = "student_account_v15_private";

function formativeContext() {
  return FormativeConversationAgentInputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    context_version: FORMATIVE_CONVERSATION_CONTEXT_VERSION,
    conversation_public_id: "conversation_v15_privacy",
    assessment_public_id: "assessment_v15_privacy",
    concept_unit_public_id: "concept_v15_privacy",
    latest_student_message:
      "Reliability describes consistency, but validity requires evidence for the intended interpretation.",
    visible_transcript: [
      {
        sequence_index: 1,
        actor: "student",
        message_text:
          "Reliability describes consistency, but validity needs separate evidence.",
        created_at: "2026-08-04T00:00:00.000Z"
      }
    ],
    administered_items: [
      {
        item_public_id: "item_v15_administered",
        item_number: 1,
        item_stem: "What does reliability establish?",
        options: [
          { label: "A", text: "Score consistency" },
          { label: "B", text: "Validity by itself" }
        ],
        student_answer: "A",
        correct_answer: "A",
        concise_explanation:
          "Reliability concerns consistency and does not establish validity by itself.",
        administered: true
      }
    ],
    assessment_specification: {
      schema_version:
        FORMATIVE_CONVERSATION_ASSESSMENT_SPECIFICATION_VERSION,
      assessment_title: "Measurement foundations",
      diagnostic_focus: "Reliability and validity",
      concept_unit_title: "Measurement evidence",
      learning_objective:
        "Distinguish score consistency from evidence for score interpretation.",
      related_concept_description: "Measurement error and interpretation",
      administered_item_guidance: [],
      boundaries: {
        administered_items_only: true,
        unadministered_item_content_protected: true,
        administered_answer_discussion_allowed: true,
        raw_teacher_notes_must_not_be_quoted: true,
        pedagogy_owner: FORMATIVE_CONVERSATION_AGENT_NAME,
        legacy_activity_routing_authoritative: false
      }
    },
    assessment_response_evidence: [
      {
        item_public_id: "item_v15_administered",
        selected_option: "A",
        correctness: "correct",
        written_reasoning:
          "Reliability is about consistency, not whether an interpretation is valid.",
        confidence: "medium",
        revision_summary: null,
        tempting_option: "B",
        tempting_option_reason: "It sounded stronger.",
        safe_timing_summary: {
          total_item_time_ms: 42_000,
          response_time_answer_ms: 8_000,
          response_time_reasoning_ms: 30_000,
          response_time_confidence_ms: 4_000
        }
      }
    ],
    assessment_process_evidence: [],
    initial_profile: {
      profile_version: "profile_v15_initial",
      outcome: "not_yet_determined",
      evidence_summary: ["The distinction is present but needs application."],
      unresolved_evidence: [],
      evidence_limitations: [],
      canonical_profile: null,
      field_evidence: []
    },
    current_profile: {
      profile_version: "profile_v15_current",
      outcome: "not_yet_determined",
      evidence_summary: ["The distinction is present but needs application."],
      unresolved_evidence: [],
      evidence_limitations: [],
      canonical_profile: null,
      field_evidence: []
    },
    allowed_misconception_claim_catalog:
      emptyCanonicalMisconceptionClaimCatalog(
        "pilot-data-governance-v15-smoke"
      ),
    intervention_history: [],
    memory: null,
    safety_boundary: {
      boundary_version: FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
      administered_item_public_ids: ["item_v15_administered"],
      unadministered_item_protection_required: true,
      hidden_prompts_excluded: true,
      raw_teacher_notes_excluded: true,
      credentials_excluded: true
    }
  });
}

function assertProviderBoundary() {
  const legacyPayload = {
    concept_unit_metadata: {
      student: { user_id: rawStudentId },
      learning_objective: "Distinguish reliability from validity."
    }
  };
  const findings = findRawStudentIdentifierFields(legacyPayload);
  assert.deepEqual(
    findings.map((finding) => finding.path),
    ["provider_payload.concept_unit_metadata.student.user_id"]
  );
  assert.throws(
    () => assertNoRawStudentIdentifiersInProviderPayload(legacyPayload),
    ProviderInputPrivacyError
  );

  const context = formativeContext();
  assertNoRawStudentIdentifiersInProviderPayload(context);
  assert.equal(
    context.assessment_response_evidence[0]?.written_reasoning,
    "Reliability is about consistency, not whether an interpretation is valid."
  );
  assert.equal(context.administered_items[0]?.correct_answer, "A");
  assert.equal(
    JSON.stringify(context).includes(rawStudentId),
    false,
    "Formative behavior context must remain identity-free."
  );

  const baseRequest: StructuredAgentRequest<
    typeof context,
    FormativeConversationAgentOutput
  > = {
    agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
    model_config: {
      model_name: "deterministic-no-provider-model",
      reasoning_effort: "medium",
      max_output_tokens: 3_500
    },
    instructions: "Deterministic no-provider privacy test.",
    input: context,
    output_schema: FormativeConversationAgentOutputSchema,
    schema_name: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    client_request_id: "v15-privacy-primary",
    timeout_ms: 90_000,
    metadata: { approved_execution_role: FORMATIVE_CONVERSATION_AGENT_NAME }
  };
  const invalidAttempt =
    FormativeConversationLogicalGenerationAuditSchema.parse({
      sequence: 1,
      kind: "primary",
      logical_call_id: "v15-privacy-primary",
      canonical_request_hash: "a".repeat(64),
      result_status: "completed",
      accepted: false,
      failure_category: "response_local_contract_invalid",
      provider_attempt_count: 1,
      transport_retry_count: 0,
      provider_request_id: null,
      provider_response_id: null,
      client_request_id: "v15-privacy-primary",
      latency_ms: 1,
      input_tokens: 10,
      output_tokens: 10,
      total_tokens: 20,
      safe_invalid_output_evidence: {
        evidence_version:
          FORMATIVE_CONVERSATION_SAFE_INVALID_OUTPUT_EVIDENCE_VERSION,
        output_presence: "decoded_json",
        candidate_hash: "b".repeat(64),
        candidate_json: {
          student_visible_message: "Let us examine the evidence together."
        },
        candidate_text: null,
        validation_status: "opening_contract_invalid",
        validation_issue_paths: ["student_visible_message"]
      }
    });
  const regenerationRequest =
    buildFormativeConversationSemanticRegenerationRequest({
      base_request: baseRequest,
      invalid_attempt: invalidAttempt,
      client_request_id: "v15-privacy-regeneration"
    });
  assertNoRawStudentIdentifiersInProviderPayload({
    input: regenerationRequest.input,
    metadata: regenerationRequest.metadata
  });
  assert.equal(JSON.stringify(regenerationRequest).includes(rawStudentId), false);
  assert.equal(
    JSON.stringify(regenerationRequest.input).includes(
      "Reliability is about consistency"
    ),
    true,
    "Semantic regeneration must retain required educational evidence."
  );

  const identityBearingInvalidAttempt =
    FormativeConversationLogicalGenerationAuditSchema.parse({
      ...invalidAttempt,
      safe_invalid_output_evidence: {
        ...invalidAttempt.safe_invalid_output_evidence,
        candidate_json: {
          student_visible_message: "Let us examine the evidence together.",
          student_id: rawStudentId
        }
      }
    });
  const blockedRegenerationRequest =
    buildFormativeConversationSemanticRegenerationRequest({
      base_request: baseRequest,
      invalid_attempt: identityBearingInvalidAttempt,
      client_request_id: "v15-privacy-regeneration-blocked"
    });
  assert.throws(
    () =>
      assertNoRawStudentIdentifiersInProviderPayload({
        input: blockedRegenerationRequest.input,
        metadata: blockedRegenerationRequest.metadata
      }),
    ProviderInputPrivacyError,
    "Identity-bearing invalid output must not be submitted for semantic regeneration."
  );
}

function assertTeacherGuidanceBoundary() {
  const normalized = normalizeInstructionalTeacherGuidance([
    {
      item_public_id: "item_v15_administered",
      target_reasoning_note:
        "Distinguish score consistency from validity. Private teacher note: student is lazy.",
      strong_reasoning_should_mention:
        "Explain that validity requires evidence supporting the intended interpretation.",
      plain_language_distractor_diagnostic_notes:
        "Option B overstates what reliability establishes; teacher-only: do not share this comment.",
      interpretation_caution:
        "Do not infer that the student is unmotivated from timing alone."
    }
  ]);
  const serialized = JSON.stringify(normalized);
  assert.match(serialized, /score consistency from validity/iu);
  assert.match(serialized, /validity requires evidence/iu);
  assert.match(serialized, /Option B overstates/iu);
  assert.match(serialized, /Do not infer/iu);
  assert.doesNotMatch(serialized, /private teacher note|teacher-only|student is lazy/iu);
}

function assertExportFilenameBoundary() {
  const previousKey = process.env.RESEARCH_PSEUDONYMIZATION_KEY;
  const previousEnvironment = process.env.APP_ENV;
  process.env.APP_ENV = "test";
  process.env.RESEARCH_PSEUDONYMIZATION_KEY =
    "v15-pilot-data-governance-deterministic-test-key";
  try {
    const first = researchStudentId(rawStudentId);
    const second = researchStudentId(rawStudentId);
    assert.equal(first, second, "Research pseudonyms must remain stable.");
    assert.match(first, /^rs_[a-f0-9]{20}$/u);

    const source = buildExportSourceIdentity({
      export_schema_version: "v15-test",
      export_scope: "selected_student",
      selected_student_id: rawStudentId,
      generated_at: new Date("2026-08-04T00:00:00.000Z")
    });
    const operationalSegment = privacySafeStudentArtifactSegment({ source });
    const researchSegment = privacySafeStudentArtifactSegment({
      source,
      stable_pseudonymous_student_id: first
    });
    assert.equal(operationalSegment.includes(rawStudentId), false);
    assert.equal(researchSegment, first);
    assert.equal(researchSegment.includes(rawStudentId), false);
  } finally {
    if (previousKey === undefined) {
      delete process.env.RESEARCH_PSEUDONYMIZATION_KEY;
    } else {
      process.env.RESEARCH_PSEUDONYMIZATION_KEY = previousKey;
    }
    if (previousEnvironment === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = previousEnvironment;
    }
  }
}

async function main() {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("network_forbidden");
  }) as typeof fetch;

  try {
    assertProviderBoundary();
    assertTeacherGuidanceBoundary();
    assertExportFilenameBoundary();
    assert.equal(networkRequests, 0);
    console.log(
      JSON.stringify(
        {
          status: "passed",
          identity_minimization_version:
            PROVIDER_INPUT_IDENTITY_MINIMIZATION_VERSION,
          teacher_guidance_boundary_version:
            FORMATIVE_CONVERSATION_TEACHER_GUIDANCE_BOUNDARY_VERSION,
          profiling_identity_fields_absent: true,
          formative_identity_fields_absent: true,
          semantic_regeneration_identity_fields_absent: true,
          required_assessment_evidence_preserved: true,
          restricted_teacher_text_absent: true,
          normalized_instructional_guidance_preserved: true,
          export_filename_raw_student_id_absent: true,
          stable_research_pseudonym_preserved: true,
          provider_calls: 0,
          model_auth_requests: 0,
          network_requests: networkRequests,
          dispatch_checkpoints: 0
        },
        null,
        2
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
