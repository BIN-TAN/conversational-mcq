import { readFileSync } from "node:fs";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  assertFormativeConversationV5BudgetReservation
} from "../src/lib/operational/formative-conversation-v5-evaluation/candidate-runner";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION
} from "../src/lib/operational/formative-conversation-v5-evaluation/contracts";
import {
  assertFormativeConversationV5FixtureHash,
  assertFormativeConversationV5ProtocolHash,
  assertFormativeConversationV5RunnerBinding,
  assertFormativeConversationV5RuntimeFingerprint,
  buildFormativeConversationV5EvaluationPlan,
  loadFormativeConversationV5EvaluationPackage,
  packagePathsExist,
  verifyFormativeConversationV5Governance
} from "../src/lib/operational/formative-conversation-v5-evaluation/package";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(
  action: () => unknown,
  expectedCode: string
) {
  try {
    action();
  } catch (error) {
    assert(
      error instanceof Error && error.message === expectedCode,
      `Expected ${expectedCode}; received ${
        error instanceof Error ? error.message : "non_error"
      }.`
    );
    return;
  }
  throw new Error(`Expected ${expectedCode} to be thrown.`);
}

function main() {
  assert(packagePathsExist(), "Executable package paths must exist.");
  const loaded = loadFormativeConversationV5EvaluationPackage();
  const governance = verifyFormativeConversationV5Governance(loaded);
  const plan = buildFormativeConversationV5EvaluationPlan();

  assert(
    loaded.fixtures.length === 8,
    "The executable inventory must contain exactly eight fixtures."
  );
  assert(
    JSON.stringify(loaded.fixtures.map((fixture) => fixture.case_id)) ===
      JSON.stringify(FORMATIVE_CONVERSATION_V5_CASE_ORDER),
    "Fixture execution order must match the frozen case order."
  );
  assert(
    loaded.fixtures.reduce(
      (sum, fixture) =>
        sum + fixture.call_graph.expected_logical_calls,
      0
    ) === 21,
    "The frozen call graph must contain exactly 21 logical calls."
  );
  assert(
    loaded.protocol.budget.expected_logical_call_count === 21 &&
      loaded.protocol.budget.maximum_logical_call_count === 21 &&
      loaded.protocol.budget.expected_provider_attempt_count === 21 &&
      loaded.protocol.budget.maximum_provider_attempt_count === 63,
    "Frozen logical-call and provider-attempt budgets must match."
  );
  assert(
    loaded.protocol.budget.maximum_concurrency === 1,
    "Provider concurrency must remain one."
  );
  assert(
    loaded.fixtures.every(
      (fixture) =>
        fixture.call_graph.production_student_profiling_called ===
          false &&
        fixture.call_graph.assistant_first_opening_called === true
    ),
    "Every fixture must use the frozen initial profile and one opening."
  );
  assert(
    loaded.protocol.runner_implementation.files.length === 5 &&
      loaded.protocol.runner_implementation.files.every(
        (reference) => /^[a-f0-9]{64}$/u.test(reference.sha256)
      ),
    "The protocol must fingerprint every exact runner implementation file."
  );
  assert(
    loaded.protocol.artifact_contract
      .all_student_visible_tutor_outputs_in_human_review &&
      loaded.protocol.artifact_contract.per_case_required_fields.includes(
        "profile_recommendation"
      ) &&
      loaded.protocol.artifact_contract.per_case_required_fields.includes(
        "teacher_projection"
      ) &&
      loaded.protocol.artifact_contract.per_case_required_fields.includes(
        "export_projection"
      ),
    "The live artifact contract must cover complete review and projection evidence."
  );

  assertFormativeConversationV5ProtocolHash(
    loaded.protocol_hash,
    loaded.protocol
  );
  const mutatedProtocol = {
    ...loaded.protocol,
    budget: {
      ...loaded.protocol.budget,
      maximum_cost_usd:
        loaded.protocol.budget.maximum_cost_usd + 1
    }
  };
  assert(
    stableHash(mutatedProtocol) !== loaded.protocol_hash,
    "A protocol mutation must change the canonical hash."
  );
  assertThrows(
    () =>
      assertFormativeConversationV5ProtocolHash(
        loaded.protocol_hash,
        mutatedProtocol
      ),
    "formative_conversation_v5_protocol_hash_mismatch"
  );

  for (const fixture of loaded.fixtures) {
    assertFormativeConversationV5FixtureHash(
      fixture.fixture_hash,
      fixture
    );
  }
  const fixture = loaded.fixtures[0];
  assertThrows(
    () =>
      assertFormativeConversationV5FixtureHash(
        fixture.fixture_hash,
        { ...fixture, title: `${fixture.title} mutated` }
      ),
    "formative_conversation_v5_fixture_hash_mismatch"
  );

  assertFormativeConversationV5RuntimeFingerprint(
    loaded.protocol.target_identity
  );
  assertThrows(
    () =>
      assertFormativeConversationV5RuntimeFingerprint({
        ...loaded.protocol.target_identity,
        prompt_hash: "0".repeat(64)
      }),
    "formative_conversation_v5_runtime_fingerprint_mismatch"
  );
  assertFormativeConversationV5RunnerBinding(
    FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION
  );
  assertThrows(
    () =>
      assertFormativeConversationV5RunnerBinding(
        "operational_model_upgrade_legacy_21_case_runner"
      ),
    "formative_conversation_v5_runner_substitution_not_permitted"
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
  assertThrows(
    () =>
      assertFormativeConversationV5BudgetReservation({
        budget,
        current: {
          logical_calls_used: 0,
          reserved_input_tokens: 0,
          reserved_output_tokens: 0,
          active_calls: 1
        },
        requested_input_tokens: 1,
        requested_output_tokens: 1
      }),
    "formative_conversation_v5_concurrency_budget_exceeded"
  );

  assert(
    loaded.fixtures.every(
      (entry) =>
        entry.synthetic_only &&
        !entry.real_student_information_present &&
        entry.synthetic_identity.namespace_template.includes(
          entry.case_id
        )
    ),
    "Every fixture must use a synthetic isolated case namespace."
  );
  assert(
    governance.candidate_inactive &&
      !governance.approval_eligible &&
      !governance.activation_permitted,
    "Candidate governance must remain inactive and ineligible."
  );
  assert(
    loaded.approval_placeholder.approval.eligible === false &&
      loaded.approval_placeholder.activation.permitted === false,
    "Approval placeholder must not permit approval or activation."
  );
  assert(
    plan.mode === "plan" &&
      plan.provider_calls === 0 &&
      plan.network_requests === 0,
    "Plan mode must be a no-provider, no-network operation."
  );
  assert(
    plan.substitutions_forbidden.includes(
      "operational_model_upgrade_legacy_21_case_runner"
    ) &&
      plan.substitutions_forbidden.includes(
        "synthetic_student_persona_cli"
      ),
    "Plan must prohibit both runner substitutions."
  );

  const cliSource = readFileSync(
    "prisma/operational-formative-conversation-v5-evaluate.ts",
    "utf8"
  );
  assert(
    cliSource.includes("--confirm-live-provider-calls") &&
      cliSource.includes("--authorization") &&
      cliSource.includes("--runtime-candidate-hash") &&
      cliSource.includes("--evaluation-protocol-hash"),
    "Live mode must require explicit confirmation, authorization, and frozen identities."
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        provider_calls: 0,
        network_requests: 0,
        case_count: loaded.fixtures.length,
        expected_logical_calls:
          loaded.protocol.budget.expected_logical_call_count,
        maximum_provider_attempts:
          loaded.protocol.budget.maximum_provider_attempt_count,
        runtime_candidate_hash: loaded.runtime_candidate_hash,
        evaluation_protocol_hash: loaded.protocol_hash,
        aggregate_fixture_hash: loaded.aggregate_fixture_hash,
        candidate_inactive: governance.candidate_inactive,
        approval_eligible: governance.approval_eligible,
        activation_permitted: governance.activation_permitted
      },
      null,
      2
    )
  );
}

main();
