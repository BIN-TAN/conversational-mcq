import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildCanonicalEvidenceCatalog,
  CanonicalEvidenceCatalogSchema,
  type CanonicalEvidenceCatalog
} from "../src/lib/domain/canonical-evidence-identity";
import { buildProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import { canonicalStructuredAgentRequestHash } from "../src/lib/llm/provider-transport-retry";
import type {
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";
import {
  FormativeConversationV18AgentOutputSchema,
  type FormativeConversationV18AgentInput,
  type FormativeConversationV18AgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18";
import { validateFormativeConversationV18CandidateAcceptance } from "../src/lib/services/student-assessment/formative-conversation/candidate-validation-v18";
import {
  FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES,
  validateFormativeConversationV18Transition
} from "../src/lib/services/student-assessment/formative-conversation/evidence-identity-validator-v18";
import {
  FormativeConversationV18ExecutionError,
  executeFormativeConversationV18,
  type FormativeConversationV18LogicalGenerationExecution
} from "../src/lib/services/student-assessment/formative-conversation/execution-v18";
import {
  v18AssessmentReasoningEvidenceId,
  v18CurrentStudentEvidenceIds,
  v18TestContext,
  v18TestTerminalOutput
} from "./formative-conversation-v18-test-fixtures";

const UNKNOWN_EVIDENCE_ID = "ev_ffffffffffffffffffffffff";
const TUTOR_EVIDENCE_ID = "ev_aaaaaaaaaaaaaaaaaaaaaaaa";
const PRIVATE_EVIDENCE_ID = "ev_bbbbbbbbbbbbbbbbbbbbbbbb";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function recommendation(output: FormativeConversationV18AgentOutput) {
  assert(output.profile_transition_recommendation);
  return output.profile_transition_recommendation;
}

function transitionValidation(input: {
  context?: FormativeConversationV18AgentInput;
  output?: FormativeConversationV18AgentOutput;
  catalog?: CanonicalEvidenceCatalog;
}) {
  const context = input.context ?? v18TestContext();
  const output = input.output ?? v18TestTerminalOutput({ context });
  return validateFormativeConversationV18Transition({
    conversation_public_id: context.conversation_public_id,
    prior_profile_evidence_cutoff_sequence_index:
      context.current_profile.evidence_cutoff_sequence_index,
    recommendation: recommendation(output),
    prior_profile: context.current_profile.canonical_profile,
    prior_misconception_claim_catalog:
      context.allowed_misconception_claim_catalog,
    allowed_evidence_catalog:
      input.catalog ?? context.allowed_evidence_catalog,
    evidence_observations: output.evidence_observations
  });
}

function issueCodes(result: ReturnType<typeof transitionValidation>) {
  return new Set(result.issues.map((entry) => entry.code));
}

function replaceEvidenceIds(
  output: FormativeConversationV18AgentOutput,
  evidenceIds: string[]
) {
  const changed = clone(output);
  const transition = recommendation(changed);
  transition.canonical_evidence_ids = [...evidenceIds];
  transition.field_evidence.forEach((entry) => {
    if (entry.disposition === "updated_from_conversation_evidence") {
      entry.evidence_ids = [...evidenceIds];
    }
  });
  transition.misconception_claim_dispositions.forEach((entry) => {
    if (entry.disposition === "resolved") {
      entry.evidence_ids = [...evidenceIds];
    }
  });
  changed.evidence_observations.forEach((entry) => {
    entry.evidence_ids = [...evidenceIds];
  });
  return FormativeConversationV18AgentOutputSchema.parse(changed);
}

function catalogWithIneligible(input: {
  context: FormativeConversationV18AgentInput;
  evidence_id: string;
  source_role: "tutor" | "teacher_private";
  evidence_kind: "formative_tutor_turn" | "teacher_private_note";
}) {
  const studentEvidence = input.context.allowed_evidence_catalog.evidence.find(
    (entry) => entry.evidence_kind === "formative_student_turn"
  );
  assert(studentEvidence);
  return CanonicalEvidenceCatalogSchema.parse({
    ...input.context.allowed_evidence_catalog,
    evidence: [
      ...input.context.allowed_evidence_catalog.evidence,
      {
        ...studentEvidence,
        evidence_id: input.evidence_id,
        source_role: input.source_role,
        evidence_kind: input.evidence_kind,
        eligibility: "not_eligible",
        content: "Restricted evidence that cannot support student understanding."
      }
    ]
  });
}

function productionRequest(context: FormativeConversationV18AgentInput) {
  return buildProductionStructuredAgentRequest({
    agent_name: "formative_conversation_agent",
    model_config: {
      model_name: "gpt-5.6-sol",
      reasoning_effort: "medium",
      max_output_tokens: 7_000
    },
    instructions: "Deterministic V18 contract smoke only.",
    input: context,
    output_schema: FormativeConversationV18AgentOutputSchema,
    schema_name: "formative-conversation-agent-contract-v3",
    client_request_id: "v18-contract-smoke",
    timeout_ms: 60_000
  });
}

function result(input: {
  request: StructuredAgentRequest<unknown, FormativeConversationV18AgentOutput>;
  status: StructuredAgentResult<FormativeConversationV18AgentOutput>["status"];
  output?: FormativeConversationV18AgentOutput;
  incomplete_reason?: string;
  error_category?: NonNullable<
    StructuredAgentResult<FormativeConversationV18AgentOutput>["error"]
  >["category"];
  output_tokens?: number;
  pre_dispatch?: boolean;
  schema_status?: "invalid_json" | "schema_invalid" | "missing_output_text";
}): FormativeConversationV18LogicalGenerationExecution {
  const preDispatch = input.pre_dispatch ?? false;
  const providerResult: StructuredAgentResult<FormativeConversationV18AgentOutput> = {
    provider: "openai",
    client_request_id: input.request.client_request_id,
    status: input.status,
    ...(input.output ? { parsed_output: input.output } : {}),
    ...(input.incomplete_reason
      ? { incomplete_reason: input.incomplete_reason }
      : {}),
    raw_output:
      input.status === "incomplete"
        ? {
            status: "incomplete",
            incomplete_details: { reason: input.incomplete_reason },
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: '{"contract_version":"formative-conversation-agent-contract-v3"'
                  }
                ]
              }
            ]
          }
        : input.output,
    usage: {
      input_tokens: 100,
      output_tokens: input.output_tokens ?? 100,
      total_tokens: 100 + (input.output_tokens ?? 100)
    },
    latency_ms: 5,
    ...(input.status === "failed"
      ? {
          error: {
            category: input.error_category ?? "network",
            message: preDispatch
              ? "Rejected before HTTP dispatch."
              : "Deterministic failure.",
            retryable: false
          }
        }
      : {}),
    ...(input.schema_status || preDispatch
      ? {
          transport_telemetry: {
            provider: "openai",
            transport: "openai_responses",
            adapter_version: "openai-responses-adapter-v4",
            client_request_id: input.request.client_request_id,
            model_name: input.request.model_config.model_name,
            base_url_host: "api.openai.com",
            base_url_approved: true,
            transport_adapter_entered: true,
            request_serialization_completed: !preDispatch,
            fetch_invoked: !preDispatch,
            response_headers_received: !preDispatch,
            response_body_started: !preDispatch,
            response_body_completed: !preDispatch,
            response_body_bytes_received: preDispatch ? 0 : 100,
            response_body_received: !preDispatch,
            ...(input.schema_status
              ? {
                  structured_output_validation_status: input.schema_status,
                  structured_output_validation_issue_paths: []
                }
              : {})
          }
        }
      : {})
  };
  return {
    result: providerResult,
    logical_call_id: `v18-logical-${createHash("sha256")
      .update(`${input.request.client_request_id}:${input.status}`)
      .digest("hex")
      .slice(0, 12)}`,
    canonical_request_hash: canonicalStructuredAgentRequestHash(input.request),
    provider_attempt_count: 1,
    transport_retry_count: 0,
    latency_ms: 5,
    pre_dispatch_request_rejection_count: preDispatch ? 1 : 0,
    http_request_count: preDispatch ? 0 : 1,
    provider_response_completed_count: preDispatch ? 0 : 1
  };
}

function validateCandidate(
  context: FormativeConversationV18AgentInput,
  output: FormativeConversationV18AgentOutput
) {
  const validation = validateFormativeConversationV18CandidateAcceptance({
    context,
    candidate: output
  });
  return {
    valid: validation.valid,
    validation_status: validation.validation_status,
    validation_issue_paths: validation.validation_issue_paths
  };
}

async function assertExecutionError(
  promise: Promise<unknown>,
  failureClass: FormativeConversationV18ExecutionError["failure_class"]
) {
  try {
    await promise;
    assert.fail(`Expected ${failureClass}.`);
  } catch (error) {
    assert(error instanceof FormativeConversationV18ExecutionError);
    assert.equal(error.failure_class, failureClass);
    return error;
  }
}

function verifyEvidenceIdentityMatrix() {
  const context = v18TestContext();
  const base = v18TestTerminalOutput({ context });
  const studentIds = v18CurrentStudentEvidenceIds(context);
  const assessmentId = v18AssessmentReasoningEvidenceId(context);

  const regeneratedContext = v18TestContext();
  assert.deepEqual(
    regeneratedContext.allowed_evidence_catalog.evidence.map((entry) => ({
      evidence_id: entry.evidence_id,
      evidence_stage: entry.evidence_stage
    })),
    context.allowed_evidence_catalog.evidence.map((entry) => ({
      evidence_id: entry.evidence_id,
      evidence_stage: entry.evidence_stage
    })),
    "Runtime-context regeneration must preserve canonical evidence identity byte-for-byte."
  );
  const processIdentityA = buildCanonicalEvidenceCatalog({
    evidence_namespace_public_id: "stable-process-scope",
    assessment_public_id: "stable-process-assessment",
    concept_unit_public_id: "stable-process-concept",
    assessment_process: [
      {
        source_public_id: "stable-process-event-a",
        event_type: "package_submitted",
        event_category: "assessment",
        event_source: "student",
        item_public_id: null,
        occurred_at: "2026-08-12T00:00:00.000Z"
      },
      {
        source_public_id: "stable-process-event-b",
        event_type: "page_visible",
        event_category: "navigation",
        event_source: "student",
        item_public_id: null,
        occurred_at: "2026-08-12T00:00:01.000Z"
      }
    ]
  });
  const processIdentityB = buildCanonicalEvidenceCatalog({
    evidence_namespace_public_id: "stable-process-scope",
    assessment_public_id: "stable-process-assessment",
    concept_unit_public_id: "stable-process-concept",
    assessment_process: [
      {
        source_public_id: "stable-process-event-b",
        event_type: "page_visible",
        event_category: "navigation",
        event_source: "student",
        item_public_id: null,
        occurred_at: "2026-08-12T00:00:01.000Z"
      },
      {
        source_public_id: "stable-process-event-a",
        event_type: "package_submitted",
        event_category: "assessment",
        event_source: "student",
        item_public_id: null,
        occurred_at: "2026-08-12T00:00:00.000Z"
      }
    ]
  });
  assert.deepEqual(
    [...processIdentityA.evidence.map((entry) => entry.evidence_id)].sort(),
    [...processIdentityB.evidence.map((entry) => entry.evidence_id)].sort(),
    "Process evidence identity must use immutable source identity, not array order."
  );
  const textMutationA = buildCanonicalEvidenceCatalog({
    evidence_namespace_public_id: "stable-turn-scope",
    assessment_public_id: "stable-turn-assessment",
    concept_unit_public_id: "stable-turn-concept",
    conversation_public_id: "stable-turn-conversation",
    transcript: [
      {
        sequence_index: 7,
        actor: "student",
        message_text: "Original persisted student wording."
      }
    ]
  });
  const textMutationB = buildCanonicalEvidenceCatalog({
    evidence_namespace_public_id: "stable-turn-scope",
    assessment_public_id: "stable-turn-assessment",
    concept_unit_public_id: "stable-turn-concept",
    conversation_public_id: "stable-turn-conversation",
    transcript: [
      {
        sequence_index: 7,
        actor: "student",
        message_text: "Different projection wording must not define identity."
      }
    ]
  });
  assert.equal(
    textMutationA.evidence[0]?.evidence_id,
    textMutationB.evidence[0]?.evidence_id,
    "Mutable free text must never participate in canonical evidence identity."
  );
  assert(
    context.allowed_evidence_catalog.evidence
      .filter((entry) => entry.evidence_kind.startsWith("assessment_"))
      .every(
        (entry) =>
          entry.evidence_stage === "baseline_assessment" &&
          entry.conversation_public_id === null
      )
  );
  assert(
    context.allowed_evidence_catalog.evidence
      .filter((entry) => entry.evidence_kind === "formative_student_turn")
      .every(
        (entry) =>
          entry.evidence_stage === "formative_conversation" &&
          entry.conversation_public_id === context.conversation_public_id
      )
  );

  assert.equal(transitionValidation({ context, output: base }).valid, true);
  assert(
    issueCodes(
      transitionValidation({
        context,
        output: replaceEvidenceIds(base, [studentIds[0], assessmentId])
      })
    ).has(FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.temporal),
    "Baseline evidence cannot be mixed into a resolved claim or changed field."
  );
  assert.equal(
    transitionValidation({
      context,
      output: replaceEvidenceIds(base, studentIds)
    }).valid,
    true,
    "Multiple valid student evidence references must pass."
  );
  assert.equal(
    recommendation(base).misconception_claim_dispositions.find(
      (entry) => entry.disposition === "retained"
    )?.evidence_ids.length,
    0,
    "Retained claims preserve prior provenance without model re-citation."
  );

  const unknown = replaceEvidenceIds(base, [UNKNOWN_EVIDENCE_ID]);
  assert(
    issueCodes(transitionValidation({ context, output: unknown })).has(
      FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.unknown
    )
  );

  const foreignScopeCatalog = buildCanonicalEvidenceCatalog({
    evidence_namespace_public_id: "foreign-student-attempt-case",
    assessment_public_id: context.assessment_public_id,
    concept_unit_public_id: context.concept_unit_public_id,
    conversation_public_id: "foreign-formative-conversation",
    transcript: [
      {
        sequence_index: 2,
        actor: "student",
        message_text: "Foreign evidence must not validate here."
      }
    ]
  });
  const foreignScopeEvidenceId = foreignScopeCatalog.evidence[0]?.evidence_id;
  assert(foreignScopeEvidenceId);
  const foreignScopeOutput = replaceEvidenceIds(base, [foreignScopeEvidenceId]);
  assert(
    issueCodes(
      transitionValidation({ context, output: foreignScopeOutput })
    ).has(FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.unknown)
  );

  const duplicate = replaceEvidenceIds(base, [studentIds[0], studentIds[0]]);
  assert(
    issueCodes(transitionValidation({ context, output: duplicate })).has(
      FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.duplicate
    )
  );

  for (const restricted of [
    {
      evidence_id: TUTOR_EVIDENCE_ID,
      source_role: "tutor" as const,
      evidence_kind: "formative_tutor_turn" as const
    },
    {
      evidence_id: PRIVATE_EVIDENCE_ID,
      source_role: "teacher_private" as const,
      evidence_kind: "teacher_private_note" as const
    }
  ]) {
    const catalog = catalogWithIneligible({ context, ...restricted });
    const output = replaceEvidenceIds(base, [studentIds[0], restricted.evidence_id]);
    assert(
      issueCodes(transitionValidation({ context, output, catalog })).has(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.ineligible
      )
    );
  }

  const foreignContext = v18TestContext();
  const foreignCatalog = clone(foreignContext.allowed_evidence_catalog);
  foreignCatalog.evidence.forEach((entry) => {
    if (entry.conversation_public_id) {
      entry.conversation_public_id = "fcv18_foreign_conversation";
    }
  });
  const foreignStudent = foreignCatalog.evidence.find(
    (entry) => entry.evidence_kind === "formative_student_turn"
  );
  assert(foreignStudent);
  const foreignOutput = replaceEvidenceIds(base, [foreignStudent.evidence_id]);
  assert(
    issueCodes(
      transitionValidation({
        context,
        output: foreignOutput,
        catalog: CanonicalEvidenceCatalogSchema.parse(foreignCatalog)
      })
    ).has(FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.conversation)
  );

  const assessmentOnly = replaceEvidenceIds(base, [assessmentId]);
  const assessmentOnlyIssues = issueCodes(
    transitionValidation({ context, output: assessmentOnly })
  );
  assert(assessmentOnlyIssues.has(
    FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.currentStudentRequired
  ));
  assert(assessmentOnlyIssues.has(
    FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.temporal
  ));

  const postProfileContext = clone(context);
  postProfileContext.current_profile.evidence_cutoff_sequence_index = 2;
  const preCutoffOutput = replaceEvidenceIds(base, [studentIds[0]]);
  assert(
    issueCodes(
      transitionValidation({
        context: postProfileContext,
        output: preCutoffOutput
      })
    ).has(FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.temporal),
    "A prior formative turn cannot prove change after a later profile state."
  );

  const freeText = clone(base) as unknown as Record<string, unknown>;
  const freeTextRecommendation = freeText.profile_transition_recommendation as Record<
    string,
    unknown
  >;
  freeTextRecommendation.canonical_evidence_ids = [
    "The student explained the distinction."
  ];
  assert.equal(FormativeConversationV18AgentOutputSchema.safeParse(freeText).success, false);

  const sequenceField = clone(base) as unknown as Record<string, unknown>;
  (sequenceField.profile_transition_recommendation as Record<string, unknown>)[
    "source_turn_sequence_indexes"
  ] = [2];
  assert.equal(
    FormativeConversationV18AgentOutputSchema.safeParse(sequenceField).success,
    false
  );

  const legacyEvidence = clone(base) as unknown as Record<string, unknown>;
  (legacyEvidence.profile_transition_recommendation as Record<string, unknown>)[
    "evidence_sequence_references"
  ] = [{ source_turn_sequence_index: 2 }];
  assert.equal(
    FormativeConversationV18AgentOutputSchema.safeParse(legacyEvidence).success,
    false
  );

  const legacy = clone(base) as unknown as Record<string, unknown>;
  (legacy.profile_transition_recommendation as Record<string, unknown>)[
    "misconception_claim_closure"
  ] = [];
  assert.equal(FormativeConversationV18AgentOutputSchema.safeParse(legacy).success, false);
}

async function verifyExecutionAndAccounting() {
  const context = v18TestContext();
  const baseOutput = v18TestTerminalOutput({ context });
  const request = productionRequest(context);

  const incompleteError = await assertExecutionError(
    executeFormativeConversationV18({
      base_request: request,
      validate_candidate: (output) => validateCandidate(context, output),
      execute_logical_generation: async ({ request: attemptedRequest }) =>
        result({
          request: attemptedRequest,
          status: "incomplete",
          incomplete_reason: "max_output_tokens",
          output_tokens: 3_500
        })
    }),
    "provider_incomplete_structured_output"
  );
  assert.equal(incompleteError.audit.semantic_regeneration_calls, 0);
  assert.equal(incompleteError.audit.incomplete_output_recovery_calls, 0);
  assert.equal(incompleteError.audit.http_requests_dispatched, 1);
  assert.equal(incompleteError.audit.provider_responses_completed, 1);
  assert.equal(incompleteError.audit.attempts[0].incomplete_reason, "max_output_tokens");
  assert.equal(incompleteError.audit.attempts[0].output_tokens, 3_500);
  assert.equal(incompleteError.audit.logical_calls_entered, 1);
  assert.equal(incompleteError.audit.parsed_candidates, 0);
  assert.equal(incompleteError.audit.semantically_accepted_candidates, 0);
  assert.equal(incompleteError.audit.transport_retries, 0);

  const syntacticError = await assertExecutionError(
    executeFormativeConversationV18({
      base_request: request,
      validate_candidate: (output) => validateCandidate(context, output),
      execute_logical_generation: async ({ request: attemptedRequest }) =>
        result({
          request: attemptedRequest,
          status: "failed",
          error_category: "schema_validation",
          schema_status: "schema_invalid"
        })
    }),
    "syntactic_structured_output_failure"
  );
  assert.equal(syntacticError.audit.semantic_regeneration_calls, 0);

  const preDispatchError = await assertExecutionError(
    executeFormativeConversationV18({
      base_request: request,
      validate_candidate: (output) => validateCandidate(context, output),
      execute_logical_generation: async ({ request: attemptedRequest }) =>
        result({
          request: attemptedRequest,
          status: "failed",
          error_category: "provider_request_schema_invalid",
          pre_dispatch: true
        })
    }),
    "syntactic_structured_output_failure"
  );
  assert.equal(preDispatchError.audit.pre_dispatch_request_rejections, 1);
  assert.equal(preDispatchError.audit.http_requests_dispatched, 0);
  assert.equal(preDispatchError.audit.provider_responses_completed, 0);
  assert.equal(preDispatchError.audit.parsed_candidates, 0);
  assert.equal(preDispatchError.audit.semantically_accepted_candidates, 0);

  const operationalPreDispatchError = await assertExecutionError(
    executeFormativeConversationV18({
      base_request: request,
      validate_candidate: (output) => validateCandidate(context, output),
      execute_logical_generation: async ({ request: attemptedRequest }) =>
        result({
          request: attemptedRequest,
          status: "failed",
          error_category: "invalid_request",
          pre_dispatch: true
        })
    }),
    "transport_failure"
  );
  assert.equal(
    operationalPreDispatchError.audit.pre_dispatch_request_rejections,
    1
  );
  assert.equal(operationalPreDispatchError.audit.http_requests_dispatched, 0);
  assert.equal(
    operationalPreDispatchError.audit.provider_responses_completed,
    0
  );

  const invalid = replaceEvidenceIds(baseOutput, [UNKNOWN_EVIDENCE_ID]);
  const regenerationCapture: {
    request?: StructuredAgentRequest<
      unknown,
      FormativeConversationV18AgentOutput
    >;
  } = {};
  const regenerated = await executeFormativeConversationV18({
    base_request: request,
    validate_candidate: (output) => validateCandidate(context, output),
    execute_logical_generation: async ({ kind, request: attemptedRequest }) => {
      if (kind === "semantic_regeneration") {
        regenerationCapture.request = attemptedRequest;
        return result({
          request: attemptedRequest,
          status: "completed",
          output: baseOutput
        });
      }
      return result({
        request: attemptedRequest,
        status: "completed",
        output: invalid
      });
    }
  });
  assert.equal(regenerated.audit.semantic_regeneration_calls, 1);
  assert.equal(regenerated.audit.parsed_candidates, 2);
  assert.equal(regenerated.audit.semantically_accepted_candidates, 1);
  assert(regenerationCapture.request);
  const regenerationInput = regenerationCapture.request.input as {
    original_context: FormativeConversationV18AgentInput;
    semantic_regeneration: {
      canonical_misconception_claim_catalog: unknown;
      canonical_eligible_evidence_catalog: unknown;
      invalid_candidate: unknown;
      invalid_candidate_hash: string;
      allowed_evidence_ids: string[];
    };
  };
  assert.deepEqual(
    regenerationInput.original_context.allowed_misconception_claim_catalog,
    context.allowed_misconception_claim_catalog
  );
  assert.deepEqual(
    regenerationInput.original_context.allowed_evidence_catalog,
    context.allowed_evidence_catalog
  );
  assert.deepEqual(
    regenerationInput.semantic_regeneration.canonical_misconception_claim_catalog,
    context.allowed_misconception_claim_catalog
  );
  assert.deepEqual(
    regenerationInput.semantic_regeneration.canonical_eligible_evidence_catalog,
    context.allowed_evidence_catalog
  );
  assert.deepEqual(regenerationInput.semantic_regeneration.invalid_candidate, invalid);
  assert.match(
    regenerationInput.semantic_regeneration.invalid_candidate_hash,
    /^[a-f0-9]{64}$/u
  );

  const inventedAgain = replaceEvidenceIds(baseOutput, [
    "ev_cccccccccccccccccccccccc"
  ]);
  const exhausted = await assertExecutionError(
    executeFormativeConversationV18({
      base_request: request,
      validate_candidate: (output) => validateCandidate(context, output),
      execute_logical_generation: async ({ kind, request: attemptedRequest }) =>
        result({
          request: attemptedRequest,
          status: "completed",
          output: kind === "base" ? invalid : inventedAgain
        })
    }),
    "parsed_semantic_contract_failure"
  );
  assert.equal(exhausted.audit.semantic_regeneration_calls, 1);
  assert.equal(exhausted.audit.semantically_accepted_candidates, 0);
}

async function main() {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("network_forbidden_in_v18_contract_smoke");
  }) as typeof fetch;
  try {
    verifyEvidenceIdentityMatrix();
    await verifyExecutionAndAccounting();
    assert.equal(networkRequests, 0);
    console.log(
      JSON.stringify(
        {
          status: "passed",
          evidence_identity_matrix: "passed",
          resolved_vs_retained_policy: "passed",
          active_legacy_contract_rejection: "passed",
          case_5_max_output_tokens_classification: "passed",
          structured_output_recovery_calls: 0,
          semantic_regeneration_catalog_identity: "passed",
          semantic_regeneration_cannot_invent_ids: "passed",
          evaluation_accounting: "passed",
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
