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
} from "../src/lib/operational/formative-conversation-v5-evaluation-v3/candidate-runner";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION,
  FORMATIVE_CONVERSATION_V5_V2_DISPATCH_PATH,
  FormativeConversationV5FixtureSchema
} from "../src/lib/operational/formative-conversation-v5-evaluation-v3/contracts";
import {
  assertFormativeConversationV5CompilationParity
} from "../src/lib/operational/formative-conversation-v5-evaluation-v3/compiler";
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
} from "../src/lib/operational/formative-conversation-v5-evaluation-v3/package";
import {
  writeFormativeConversationV5DispatchCheckpoint
} from "../src/lib/operational/formative-conversation-v5-evaluation-v3/service";
import {
  exactFormativeConversationV5LiveAuthorization as exactV2Authorization,
  loadFormativeConversationV5EvaluationPackage as loadV2Package
} from "../src/lib/operational/formative-conversation-v5-evaluation/package";

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
  assert(packagePathsExist(), "v3 package paths must exist.");
  const loaded = loadFormativeConversationV5EvaluationPackage();
  const governance = verifyFormativeConversationV5Governance(loaded);
  const plan = buildFormativeConversationV5EvaluationPlan();

  assert(
    loaded.fixtures.length === 8,
    "The v3 inventory must contain exactly eight fixtures."
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

  const v3Source = [
    "src/lib/operational/formative-conversation-v5-evaluation-v3/service.ts",
    "src/lib/operational/formative-conversation-v5-evaluation-v3/compiler.ts",
    "src/lib/operational/formative-conversation-v5-evaluation-v3/contracts.ts"
  ]
    .map((filePath) => readFileSync(filePath, "utf8"))
    .join("\n");
  assert(
    !v3Source.includes("SyntheticStudentPersonaSchema") &&
      !v3Source.includes(
        "runSyntheticStudentResearchValidation"
      ),
    "v3 must not compile or execute cases through the shared persona schema."
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

  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "fcv5-v3-checkpoint-")
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
      provider_run_id: "fcv5v3_provider_smoke",
      derived_evaluation_id: "fcv5v3_derived_smoke",
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
          provider_run_id: "fcv5v3_provider_smoke_rerun",
          derived_evaluation_id: "fcv5v3_derived_smoke_rerun",
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

  const v2 = loadV2Package();
  const v2Authorization = exactV2Authorization(v2);
  const v3Authorization =
    exactFormativeConversationV5LiveAuthorization(loaded);
  assert(
    v3Authorization !== v2Authorization &&
      v3Authorization.includes(
        "formative-conversation-host-v5-executable-v3"
      ) &&
      v3Authorization.includes(loaded.protocol_hash),
    "v3 must require a new exact authorization."
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
    governance.candidate_inactive &&
      !governance.approval_eligible &&
      !governance.activation_permitted &&
      loaded.approval_placeholder.approval.eligible === false &&
      loaded.approval_placeholder.activation.permitted === false,
    "v3 must remain inactive, approval-ineligible, and activation-forbidden."
  );
  assert(
    plan.mode === "plan" &&
      plan.provider_calls === 0 &&
      plan.provider_network_requests === 0 &&
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
          : "formative_conversation_v5_v3_smoke_failed",
      provider_calls: 0,
      secrets_printed: false
    })
  );
  process.exitCode = 1;
});
