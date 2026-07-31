import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  assertFormativeConversationV5BudgetReservation
} from "../src/lib/operational/formative-conversation-v5-evaluation-v7/candidate-runner";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION,
  FORMATIVE_CONVERSATION_V5_V2_DISPATCH_PATH,
  FORMATIVE_CONVERSATION_V5_V3_DISPATCH_PATH,
  FORMATIVE_CONVERSATION_V5_V3_RUN_ROOT,
  FORMATIVE_CONVERSATION_V5_V6_DISPATCH_PATH,
  FORMATIVE_CONVERSATION_V5_V6_FAILURE_ANALYSIS_PATH,
  FORMATIVE_CONVERSATION_V5_V6_HUMAN_REVIEW_ADVISORY_PATH,
  FORMATIVE_CONVERSATION_V5_V6_RUN_ROOT,
  FormativeConversationV5FixtureSchema
} from "../src/lib/operational/formative-conversation-v5-evaluation-v7/contracts";
import {
  assertFormativeConversationV5CompilationParity
} from "../src/lib/operational/formative-conversation-v5-evaluation-v7/compiler";
import {
  assertFormativeConversationV5FixtureHash,
  assertFormativeConversationV5ProtocolHash,
  assertFormativeConversationV5RunnerBinding,
  assertFormativeConversationV5RuntimeFingerprint,
  buildFormativeConversationV5EvaluationPlan,
  exactFormativeConversationV5LiveAuthorization,
  loadFormativeConversationV5EvaluationPackage,
  packagePathsExist,
  verifyFormativeConversationV5Governance
} from "../src/lib/operational/formative-conversation-v5-evaluation-v7/package";
import {
  writeFormativeConversationV5DispatchCheckpoint
} from "../src/lib/operational/formative-conversation-v5-evaluation-v7/service";
import {
  formativeConversationMessageAccountingIssues
} from "../src/lib/evaluation/synthetic-student-validation/framework";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FormativeConversationAgentOutputSchema
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  validateFormativeConversationOpeningOutput
} from "../src/lib/services/student-assessment/formative-conversation/opening-contract";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256File(filePath: string) {
  return createHash("sha256")
    .update(readFileSync(filePath))
    .digest("hex");
}

function assertThrows(
  action: () => unknown,
  expectedCode: string
) {
  try {
    action();
  } catch (error) {
    assert(
      error instanceof Error &&
        (error.message === expectedCode ||
          error.message.includes(expectedCode)),
      `Expected ${expectedCode}; received ${
        error instanceof Error ? error.message : "non_error"
      }.`
    );
    return;
  }
  throw new Error(`Expected ${expectedCode} to be thrown.`);
}

async function assertRejects(
  action: () => Promise<unknown>,
  expectedCode: string
) {
  try {
    await action();
  } catch (error) {
    assert(
      error instanceof Error &&
        error.message === expectedCode,
      `Expected ${expectedCode}; received ${
        error instanceof Error ? error.message : "non_error"
      }.`
    );
    return;
  }
  throw new Error(`Expected ${expectedCode} to be rejected.`);
}

async function main() {
  assert(packagePathsExist(), "v5 package paths must exist.");
  const loaded = loadFormativeConversationV5EvaluationPackage();
  const governance = verifyFormativeConversationV5Governance(loaded);
  const plan = buildFormativeConversationV5EvaluationPlan();

  assert(
    loaded.fixtures.length === 8,
    "The v5 inventory must contain exactly eight fixtures."
  );
  assert(
    JSON.stringify(
      loaded.fixtures.map((fixture) => fixture.case_id)
    ) === JSON.stringify(FORMATIVE_CONVERSATION_V5_CASE_ORDER),
    "Fixture order must match the frozen case order."
  );
  const expectedMessageCounts = [0, 2, 1, 1, 2, 2, 3, 2];
  const expectedLogicalCalls = [1, 3, 2, 2, 3, 3, 4, 3];
  assert(
    loaded.fixtures.every(
      (fixture, index) =>
        fixture.expected_student_message_count ===
          expectedMessageCounts[index] &&
        fixture.student_messages.length ===
          expectedMessageCounts[index] &&
        fixture.expected_logical_call_count ===
          expectedLogicalCalls[index]
    ),
    "Every fixture must preserve its exact declared message and call counts."
  );
  assert(
    loaded.fixtures[0].execution_case_type ===
      "opening_only" &&
      loaded.fixtures[2].execution_case_type ===
        "single_message_conversation" &&
      loaded.fixtures[3].execution_case_type ===
        "single_message_conversation" &&
      loaded.fixtures[1].execution_case_type ===
        "multi_message_adaptive" &&
      loaded.fixtures.slice(4).every(
        (fixture) =>
          fixture.execution_case_type === "profile_transition"
      ),
    "The four protocol-specific execution shapes must be explicit."
  );
  assert(
    loaded.compiled_plan.cases.every(
      (entry, index) =>
        entry.compilation_status === "compiled" &&
        entry.call_graph.actual_student_message_count ===
          expectedMessageCounts[index] &&
        entry.call_graph.declared_student_message_count ===
          expectedMessageCounts[index] &&
        entry.call_graph.expected_logical_call_count ===
          expectedLogicalCalls[index]
    ),
    "All eight cases must compile to exact production-service templates."
  );
  assert(
    loaded.compiled_plan.aggregate_call_graph
      .opening_call_count === 8 &&
      loaded.compiled_plan.aggregate_call_graph
        .student_message_call_count === 13 &&
      loaded.compiled_plan.aggregate_call_graph
        .profiling_call_count === 0 &&
      loaded.compiled_plan.aggregate_call_graph
        .expected_logical_call_count === 21 &&
      loaded.compiled_plan.aggregate_call_graph
        .maximum_provider_attempt_count === 63,
    "The aggregate call graph must be 8 openings plus 13 message responses."
  );
  assertFormativeConversationV5CompilationParity({
    committed: loaded.compiled_plan,
    compiled: loaded.compiled_plan
  });

  const v5Source = [
    "src/lib/operational/formative-conversation-v5-evaluation-v7/service.ts",
    "src/lib/operational/formative-conversation-v5-evaluation-v7/compiler.ts",
    "src/lib/operational/formative-conversation-v5-evaluation-v7/contracts.ts"
  ]
    .map((filePath) => readFileSync(filePath, "utf8"))
    .join("\n");
  assert(
    !v5Source.includes("SyntheticStudentPersonaSchema") &&
      !v5Source.includes(
        "runSyntheticStudentResearchValidation"
      ),
    "v5 must not compile or execute cases through the shared persona schema."
  );
  assert(
    loaded.fixtures.every((fixture) =>
      fixture.student_messages.every(
        (message) =>
          !/\b(?:dummy|padding|placeholder message)\b/iu.test(
            message.message_text
          )
      )
    ),
    "Fixtures must not contain dummy-message padding."
  );

  const directAnswer = loaded.fixtures[2];
  assertThrows(
    () =>
      FormativeConversationV5FixtureSchema.parse({
        ...directAnswer,
        call_graph: {
          ...directAnswer.call_graph,
          student_message_count: 2
        }
      }),
    "declared_actual_call_count_mismatch"
  );
  assertThrows(
    () =>
      FormativeConversationV5FixtureSchema.parse({
        ...directAnswer,
        student_messages: []
      }),
    "Array must contain exactly 1 element"
  );
  assertThrows(
    () =>
      FormativeConversationV5FixtureSchema.parse({
        ...directAnswer,
        student_messages: [
          ...directAnswer.student_messages,
          directAnswer.student_messages[0]
        ]
      }),
    "Array must contain exactly 1 element"
  );
  const adaptive = loaded.fixtures[1];
  assertThrows(
    () =>
      FormativeConversationV5FixtureSchema.parse({
        ...adaptive,
        student_messages: adaptive.student_messages.map(
          (message, index) => ({
            ...message,
            sequence: index + 2
          })
        )
      }),
    "student_message_order_invalid"
  );

  assertFormativeConversationV5ProtocolHash(
    loaded.protocol_hash,
    loaded.protocol
  );
  assertThrows(
    () =>
      assertFormativeConversationV5ProtocolHash(
        loaded.protocol_hash,
        {
          ...loaded.protocol,
          budget: {
            ...loaded.protocol.budget,
            maximum_cost_usd: 31
          }
        }
      ),
    "formative_conversation_v5_protocol_hash_mismatch"
  );
  for (const fixture of loaded.fixtures) {
    assertFormativeConversationV5FixtureHash(
      fixture.fixture_hash,
      fixture
    );
  }
  assertFormativeConversationV5RuntimeFingerprint(
    loaded.protocol.target_identity
  );
  assertFormativeConversationV5RunnerBinding(
    FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION
  );
  assertThrows(
    () =>
      assertFormativeConversationV5RunnerBinding(
        "synthetic_student_persona_cli"
      ),
    "formative_conversation_v5_runner_substitution_not_permitted"
  );

  const budget = loaded.protocol.budget;
  assertFormativeConversationV5BudgetReservation({
    budget,
    current: {
      logical_calls_used: 20,
      reserved_input_tokens: 899_000,
      reserved_output_tokens: 70_000,
      active_calls: 0
    },
    requested_input_tokens: 1_000,
    requested_output_tokens: 3_500
  });
  assertThrows(
    () =>
      assertFormativeConversationV5BudgetReservation({
        budget,
        current: {
          logical_calls_used: 21,
          reserved_input_tokens: 0,
          reserved_output_tokens: 0,
          active_calls: 0
        },
        requested_input_tokens: 1,
        requested_output_tokens: 1
      }),
    "formative_conversation_v5_logical_call_budget_exceeded"
  );

  const openingRegression = JSON.parse(
    readFileSync(
      "config/operational-candidates/formative-conversation-host-v5-executable-v7/regressions/case7-opening-output.json",
      "utf8"
    )
  ) as { opening_text: string; expected_valid: boolean };
  const openingValidation =
    validateFormativeConversationOpeningOutput({
      contract_version:
        FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      student_visible_message: openingRegression.opening_text,
      teaching_artifact: null,
      evidence_observations: [],
      profile_transition_recommendation: null,
      teacher_assistance_recommendation: {
        recommended: false,
        reason_code: null
      },
      lifecycle_recommendation: "continue"
    });
  assert(
    openingRegression.expected_valid &&
      openingValidation.valid &&
      openingValidation.issue_codes.length === 0,
    "The exact immutable Case 7 opening must pass opening validator v2."
  );
  const case6Transcript = JSON.parse(
    readFileSync(
      `${FORMATIVE_CONVERSATION_V5_V3_RUN_ROOT}/cases/fcv5_06_largely_improved_temporal-transcript.json`,
      "utf8"
    )
  ) as {
    agent_calls: Array<{
      student_visible_tutor_output: string | null;
      profile_recommendation: unknown;
      teacher_assistance_recommendation: unknown;
      evidence_observations: unknown;
      lifecycle_recommendation: unknown;
    }>;
  };
  const case6RecommendationCall =
    case6Transcript.agent_calls.find(
      (call) =>
        (
          call.profile_recommendation as
            | { recommended?: boolean }
            | null
        )?.recommended === true
    );
  assert(
    case6RecommendationCall?.student_visible_tutor_output,
    "The exact immutable Case 6 recommendation output must be present."
  );
  const case6Output = FormativeConversationAgentOutputSchema.parse({
    contract_version:
      FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    student_visible_message:
      case6RecommendationCall.student_visible_tutor_output,
    teaching_artifact: null,
    evidence_observations:
      case6RecommendationCall.evidence_observations,
    profile_transition_recommendation:
      case6RecommendationCall.profile_recommendation,
    teacher_assistance_recommendation:
      case6RecommendationCall.teacher_assistance_recommendation,
    lifecycle_recommendation:
      case6RecommendationCall.lifecycle_recommendation
  });
  const case6RetainedEvidence =
    case6Output.profile_transition_recommendation?.field_evidence.find(
      (entry) =>
        entry.disposition ===
          "retained_evidence_remains_valid" &&
        entry.profile_fields.includes(
          "process_interpretation_cautions"
        )
    );
  assert(
    case6Output.profile_transition_recommendation?.proposed_outcome ===
      "largely_improved_understanding" &&
      case6RetainedEvidence?.evidence_basis === "combined" &&
      case6RetainedEvidence.source_turn_sequence_indexes.length > 0,
    "The exact immutable Case 6 output must reproduce the evidence-backed retained-list extension."
  );
  for (const caseId of [
    "fcv5_05_sound_profile_transition",
    "fcv5_08_mixed_resolved_evidence"
  ]) {
    const historicalTranscript = JSON.parse(
      readFileSync(
        `${FORMATIVE_CONVERSATION_V5_V3_RUN_ROOT}/cases/${caseId}-transcript.json`,
        "utf8"
      )
    ) as {
      transcript: Array<{
        actor: "student" | "tutor";
        assistant_response_status: string | null;
        assistant_response_retry_count: number;
      }>;
      agent_calls: Array<{
        call_status: string;
        provider_attempt_count: number;
        retry_count: number;
        latency_ms: number | null;
        input_tokens: number | null;
        output_tokens: number | null;
        student_visible_tutor_output: string | null;
      }>;
      telemetry_summary: {
        input_telemetry_count: number;
      };
    };
    const failedStudentTurn = [...historicalTranscript.transcript]
      .reverse()
      .find((turn) => turn.actor === "student");
    const failedAgentCall = [...historicalTranscript.agent_calls]
      .reverse()
      .find((call) => call.call_status === "failed");
    const submittedStudentTurnCount =
      historicalTranscript.transcript.filter(
        (turn) => turn.actor === "student"
      ).length;
    assert(
      failedStudentTurn?.assistant_response_status === "failed" &&
        failedStudentTurn.assistant_response_retry_count === 0 &&
        failedAgentCall?.provider_attempt_count === 1 &&
        failedAgentCall.retry_count === 0 &&
        failedAgentCall.latency_ms === null &&
        failedAgentCall.input_tokens === null &&
        failedAgentCall.output_tokens === null &&
        failedAgentCall.student_visible_tutor_output === null &&
        historicalTranscript.telemetry_summary
          .input_telemetry_count === submittedStudentTurnCount,
      `${caseId} must retain its exact failed, recoverable, one-attempt historical boundary without fabricated partial output.`
    );
  }

  const accountingCases = [
    {
      label: "opening_failure_before_submission",
      input: {
        execution_error: "opening_validation_failed",
        planned_student_messages: 3,
        submission_attempts: 0,
        persisted_student_messages: 0,
        completed_student_exchanges: 0,
        input_telemetry_count: 0,
        tutor_turn_count: 0
      },
      expected: []
    },
    {
      label: "failure_after_student_persistence",
      input: {
        execution_error: "agent_call_failed",
        planned_student_messages: 2,
        submission_attempts: 1,
        persisted_student_messages: 1,
        completed_student_exchanges: 0,
        input_telemetry_count: 1,
        tutor_turn_count: 1
      },
      expected: []
    },
    {
      label: "partial_execution_missing_input_telemetry",
      input: {
        execution_error: "agent_call_failed",
        planned_student_messages: 2,
        submission_attempts: 1,
        persisted_student_messages: 1,
        completed_student_exchanges: 0,
        input_telemetry_count: 0,
        tutor_turn_count: 1
      },
      expected: ["input_telemetry_count_mismatch"]
    },
    {
      label: "successful_complete_case",
      input: {
        execution_error: null,
        planned_student_messages: 2,
        submission_attempts: 2,
        persisted_student_messages: 2,
        completed_student_exchanges: 2,
        input_telemetry_count: 2,
        tutor_turn_count: 3
      },
      expected: []
    }
  ] as const;
  for (const testCase of accountingCases) {
    assert(
      JSON.stringify(
        formativeConversationMessageAccountingIssues(testCase.input)
      ) === JSON.stringify(testCase.expected),
      `Message accounting replay failed: ${testCase.label}.`
    );
  }

  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "fcv5-v5-checkpoint-")
  );
  try {
    const checkpointPath = path.join(
      tempRoot,
      "dispatch",
      `${loaded.protocol_hash}.json`
    );
    assert(
      !existsSync(checkpointPath),
      "Pre-dispatch validation must not create a checkpoint."
    );
    assertThrows(
      () =>
        FormativeConversationV5FixtureSchema.parse({
          ...directAnswer,
          call_graph: {
            ...directAnswer.call_graph,
            student_message_count: 2
          }
        }),
      "declared_actual_call_count_mismatch"
    );
    assert(
      !existsSync(checkpointPath),
      "Failed local compilation must leave the checkpoint absent."
    );
    await writeFormativeConversationV5DispatchCheckpoint({
      dispatch_root: tempRoot,
      provider_run_id: "fcv5v7_provider_smoke",
      derived_evaluation_id: "fcv5v7_derived_smoke",
      runtime_candidate_hash: loaded.runtime_candidate_hash,
      evaluation_protocol_hash: loaded.protocol_hash,
      compiled_plan_hash:
        loaded.compiled_plan.compiled_plan_hash
    });
    assert(
      existsSync(checkpointPath),
      "The checkpoint must be creatable only at the explicit dispatch boundary."
    );
    await assertRejects(
      () =>
        writeFormativeConversationV5DispatchCheckpoint({
          dispatch_root: tempRoot,
          provider_run_id: "fcv5v7_provider_smoke_rerun",
          derived_evaluation_id: "fcv5v7_derived_smoke_rerun",
          runtime_candidate_hash:
            loaded.runtime_candidate_hash,
          evaluation_protocol_hash: loaded.protocol_hash,
          compiled_plan_hash:
            loaded.compiled_plan.compiled_plan_hash
        }),
      "formative_conversation_v5_protocol_already_dispatched"
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  const v7Authorization =
    exactFormativeConversationV5LiveAuthorization(loaded);
  assert(
    loaded.runtime_candidate_hash !==
      loaded.protocol.failed_v5_execution.runtime_candidate_hash &&
      loaded.runtime_candidate_hash !==
        loaded.protocol.failed_v6_execution.runtime_candidate_hash &&
      loaded.candidate_manifest.runtime_behavior_changed &&
      !loaded.candidate_manifest.runtime_candidate_hash_unchanged &&
      !loaded.candidate_identity.runtime_candidate_hash_unchanged &&
      loaded.protocol_hash !==
        loaded.protocol.failed_v5_execution.protocol_hash &&
      loaded.protocol_hash !==
        loaded.protocol.failed_v6_execution.protocol_hash &&
      v7Authorization.includes(
        "formative-conversation-host-v5-executable-v7"
      ) &&
      v7Authorization.includes(loaded.runtime_candidate_hash) &&
      v7Authorization.includes(loaded.protocol_hash),
    "v7 must use fresh runtime and protocol identities while preserving the failed v5 and v6 references."
  );
  assert(
    loaded.protocol.failed_v2_execution.execution_status ===
      "not_exercised" &&
      !loaded.protocol.failed_v2_execution.approval_eligible &&
      !loaded.protocol.failed_v2_execution.rerunnable,
    "The v2 failure must remain not exercised, ineligible, and not rerunnable."
  );
  let v2CheckpointVerification = "reference_verified";
  if (existsSync(FORMATIVE_CONVERSATION_V5_V2_DISPATCH_PATH)) {
    assert(
      sha256File(FORMATIVE_CONVERSATION_V5_V2_DISPATCH_PATH) ===
        loaded.protocol.failed_v2_execution
          .dispatch_checkpoint_sha256,
      "The local v2 dispatch checkpoint must remain immutable."
    );
    v2CheckpointVerification = "artifact_verified";
  }
  assert(
    loaded.protocol.failed_v3_execution.execution_status ===
      "completed_failed" &&
      !loaded.protocol.failed_v3_execution.approval_eligible &&
      !loaded.protocol.failed_v3_execution.rerunnable &&
      loaded.protocol.failed_v3_execution.preserved_immutable &&
      sha256File(FORMATIVE_CONVERSATION_V5_V3_DISPATCH_PATH) ===
        loaded.protocol.failed_v3_execution
          .dispatch_checkpoint_sha256 &&
      sha256File(
        `${FORMATIVE_CONVERSATION_V5_V3_RUN_ROOT}/source-provider-run.json`
      ) ===
        loaded.protocol.failed_v3_execution
          .source_provider_run_sha256 &&
      sha256File(
        `${FORMATIVE_CONVERSATION_V5_V3_RUN_ROOT}/derived-evaluation.json`
      ) ===
        loaded.protocol.failed_v3_execution
          .derived_evaluation_sha256,
    "The completed-failed v3 evidence must remain immutable, ineligible, and non-rerunnable."
  );
  assert(
    loaded.failed_v4_pre_dispatch.source_commit_sha ===
      "c9082e8457c1f3a11a5fd9acbd1ca250e889363c" &&
      loaded.failed_v4_pre_dispatch.protocol_hash ===
        "662a9e2e9ec2929147bd7ec0150708186f07e32ff2029f606de6b0e9d502c84e" &&
      loaded.failed_v4_pre_dispatch
        .sandbox_launcher_failure === "tsx_ipc_socket_eperm" &&
      loaded.failed_v4_pre_dispatch
        .approved_execution_failure ===
        "approved_config_hash_mismatch" &&
      !loaded.failed_v4_pre_dispatch
        .dispatch_checkpoint_created &&
      !loaded.failed_v4_pre_dispatch.provider_run_created &&
      !loaded.failed_v4_pre_dispatch
        .generation_request_created &&
      loaded.failed_v4_pre_dispatch.provider_calls === 0 &&
      loaded.failed_v4_pre_dispatch.preserved_immutable &&
      !loaded.failed_v4_pre_dispatch.rerunnable,
    "The failed v4 pre-dispatch evidence must remain immutable and prove that no dispatch occurred."
  );
  const v6FailureAnalysis = JSON.parse(
    readFileSync(
      FORMATIVE_CONVERSATION_V5_V6_FAILURE_ANALYSIS_PATH,
      "utf8"
    )
  ) as {
    immutable_source: {
      provider_run_id: string;
      derived_evaluation_id: string;
      rerunnable: boolean;
    };
    results: {
      passed: number;
      failed: number;
      invalid: number;
      logical_calls: number;
      provider_attempts: number;
    };
    provider_calls_during_analysis: number;
    provider_network_requests_during_analysis: number;
    database_audit_queries_during_analysis: number;
  };
  const v6ReviewAdvisory = JSON.parse(
    readFileSync(
      FORMATIVE_CONVERSATION_V5_V6_HUMAN_REVIEW_ADVISORY_PATH,
      "utf8"
    )
  ) as {
    advisory_human_review_eligible: boolean;
    approval_evidence_eligible: boolean;
    activation_permitted: boolean;
    provider_calls_during_advisory: number;
  };
  assert(
    loaded.protocol.failed_v6_execution.execution_status ===
      "completed_failed" &&
      loaded.protocol.failed_v6_execution.passed === 5 &&
      loaded.protocol.failed_v6_execution.failed === 3 &&
      loaded.protocol.failed_v6_execution.invalid === 0 &&
      !loaded.protocol.failed_v6_execution.approval_eligible &&
      !loaded.protocol.failed_v6_execution.rerunnable &&
      loaded.protocol.failed_v6_execution.preserved_immutable &&
      sha256File(FORMATIVE_CONVERSATION_V5_V6_DISPATCH_PATH) ===
        loaded.protocol.failed_v6_execution
          .dispatch_checkpoint_sha256 &&
      sha256File(
        `${FORMATIVE_CONVERSATION_V5_V6_RUN_ROOT}/source-provider-run.json`
      ) ===
        loaded.protocol.failed_v6_execution
          .source_provider_run_sha256 &&
      sha256File(
        `${FORMATIVE_CONVERSATION_V5_V6_RUN_ROOT}/derived-evaluation.json`
      ) ===
        loaded.protocol.failed_v6_execution
          .derived_evaluation_sha256 &&
      sha256File(
        `${FORMATIVE_CONVERSATION_V5_V6_RUN_ROOT}/human-review-package.json`
      ) ===
        loaded.protocol.failed_v6_execution
          .human_review_package_sha256 &&
      v6FailureAnalysis.immutable_source.provider_run_id ===
        loaded.protocol.failed_v6_execution.provider_run_id &&
      v6FailureAnalysis.immutable_source.derived_evaluation_id ===
        loaded.protocol.failed_v6_execution.derived_evaluation_id &&
      !v6FailureAnalysis.immutable_source.rerunnable &&
      v6FailureAnalysis.results.passed === 5 &&
      v6FailureAnalysis.results.failed === 3 &&
      v6FailureAnalysis.results.invalid === 0 &&
      v6FailureAnalysis.results.logical_calls === 21 &&
      v6FailureAnalysis.results.provider_attempts === 21 &&
      v6FailureAnalysis.provider_calls_during_analysis === 0 &&
      v6FailureAnalysis.provider_network_requests_during_analysis === 0 &&
      v6FailureAnalysis.database_audit_queries_during_analysis === 1 &&
      !v6ReviewAdvisory.advisory_human_review_eligible &&
      !v6ReviewAdvisory.approval_evidence_eligible &&
      !v6ReviewAdvisory.activation_permitted &&
      v6ReviewAdvisory.provider_calls_during_advisory === 0,
    "The completed-failed v6 execution and no-provider adjudication must remain immutable, ineligible, and non-rerunnable."
  );
  const failureAnalysis = JSON.parse(
    readFileSync(
      "config/operational-candidates/formative-conversation-host-v5-executable-v7/v3-failure-analysis.json",
      "utf8"
    )
  ) as {
    case_findings: Array<{ case_id: string }>;
    provider_calls: number;
    prompt_change_required: boolean;
  };
  const reviewAdvisory = JSON.parse(
    readFileSync(
      "config/operational-candidates/formative-conversation-host-v5-executable-v7/v3-human-review-advisory.json",
      "utf8"
    )
  ) as {
    output_count: number;
    official_approval_evidence: boolean;
    reviewed_outputs: unknown[];
  };
  assert(
    failureAnalysis.case_findings.length === 4 &&
      failureAnalysis.provider_calls === 0 &&
      !failureAnalysis.prompt_change_required &&
      reviewAdvisory.output_count === 15 &&
      reviewAdvisory.reviewed_outputs.length === 15 &&
      !reviewAdvisory.official_approval_evidence,
    "The v3 failure analysis and all-output human review must remain no-provider advisory evidence."
  );

  assert(
    governance.candidate_inactive &&
      !governance.approval_eligible &&
      !governance.activation_permitted &&
      loaded.approval_placeholder.approval.eligible === false &&
      loaded.approval_placeholder.activation.permitted === false,
    "v7 must remain inactive, approval-ineligible, and activation-forbidden."
  );
  assert(
    plan.mode === "plan" &&
      plan.provider_calls === 0 &&
      plan.provider_network_requests === 0 &&
      plan.provider_auth_network_requests === 0 &&
      plan.database_readiness_queries === 1 &&
      plan.live_environment.launcher
        .plan_and_live_share_launcher &&
      !plan.live_environment.launcher.tsx_cli_ipc_used &&
      plan.compiled_execution_plan.compilation_status ===
        "ready_for_dispatch",
    "Plan mode must contain the compiled execution proof without provider access."
  );
  assert(
    stableHash(loaded.compiled_plan).length === 64,
    "The compiled plan must be canonically hashable."
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        provider_calls: 0,
        provider_network_requests: 0,
        case_count: loaded.fixtures.length,
        per_case_student_message_counts:
          expectedMessageCounts,
        per_case_logical_calls: expectedLogicalCalls,
        expected_logical_calls:
          loaded.protocol.budget.expected_logical_call_count,
        maximum_provider_attempts:
          loaded.protocol.budget.maximum_provider_attempt_count,
        runtime_candidate_hash: loaded.runtime_candidate_hash,
        evaluation_protocol_hash: loaded.protocol_hash,
        runner_implementation_hash:
          loaded.protocol.runner_implementation.aggregate_hash,
        fixture_manifest_hash:
          loaded.fixture_manifest_hash,
        aggregate_fixture_hash:
          loaded.aggregate_fixture_hash,
        compiled_plan_hash:
          loaded.compiled_plan.compiled_plan_hash,
        v2_checkpoint_verification: v2CheckpointVerification,
        v3_checkpoint_verification: "artifact_verified",
        v4_pre_dispatch_evidence: "artifact_verified",
        v6_execution_evidence: "artifact_verified",
        v6_no_provider_analysis: "artifact_verified",
        case7_opening_replay: "passed",
        case6_exact_output_replay: "passed",
        case5_and_case8_failure_replays: "passed",
        partial_execution_accounting_replays:
          accountingCases.length,
        v3_outputs_reviewed: reviewAdvisory.output_count,
        candidate_inactive: governance.candidate_inactive,
        approval_eligible: governance.approval_eligible,
        activation_permitted: governance.activation_permitted
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message.split(":", 1)[0]
          : "formative_conversation_v5_v7_smoke_failed",
      provider_calls: 0,
      secrets_printed: false
    })
  );
  process.exitCode = 1;
});
