import { stableHash } from "@/lib/operational/stable-hash";
import { compileFormativeConversationV5ExecutionPlan as compileFormativeV16Plan } from "../formative-conversation-v5-evaluation-v16/compiler";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_END_TO_END_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS,
  FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
  FormativeConversationV18CompiledPlanSchema,
  FormativeConversationV18FixtureSchema,
  type FormativeConversationV18Budget,
  type FormativeConversationV18CompiledPlan,
  type FormativeConversationV18Fixture
} from "./contracts";

export type FormativeConversationV18CompilationInput = {
  runtime_candidate_hash: string;
  evaluation_protocol_hash: string;
  runner_implementation_hash: string;
  live_environment_contract_hash: string;
  fixture_manifest_hash: string;
  aggregate_fixture_hash: string;
  fixtures: readonly unknown[];
  fixture_file_sha256_by_case: Readonly<Record<string, string>>;
  budget: FormativeConversationV18Budget;
};

function assertCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function namespaceFor(fixture: FormativeConversationV18Fixture) {
  const caseNamespace = `<provider_run_id>:${fixture.case_id}`;
  return {
    run_namespace_template: "<provider_run_id>" as const,
    case_namespace_template: caseNamespace,
    collision_check_key: stableHash({
      case_id: fixture.case_id,
      case_type: fixture.case_type,
      fixture_hash: fixture.fixture_hash,
      namespace: caseNamespace
    })
  };
}

export function compileFormativeConversationV18ExecutionPlan(
  input: FormativeConversationV18CompilationInput
) {
  const fixtures = input.fixtures.map((fixture) =>
    FormativeConversationV18FixtureSchema.parse(fixture)
  );
  assertCondition(
    fixtures.length === 12 &&
      fixtures.every(
        (fixture, index) =>
          fixture.case_id === FORMATIVE_CONVERSATION_V5_CASE_ORDER[index] &&
          fixture.case_order === index + 1
      ),
    "formative_conversation_v18_case_inventory_or_order_invalid"
  );

  const profilingFixtures = fixtures.filter(
    (fixture): fixture is Extract<
      FormativeConversationV18Fixture,
      { case_type: "profiling_contract_canary" }
    > => fixture.case_type === "profiling_contract_canary"
  );
  const formativeFixtures = fixtures.filter(
    (fixture): fixture is Extract<
      FormativeConversationV18Fixture,
      { case_type: "formative_conversation" }
    > => fixture.case_type === "formative_conversation"
  );
  const endToEndFixtures = fixtures.filter(
    (fixture): fixture is Extract<
      FormativeConversationV18Fixture,
      { case_type: "dissertation_end_to_end" }
    > => fixture.case_type === "dissertation_end_to_end"
  );
  assertCondition(
    profilingFixtures.length === 3 &&
      formativeFixtures.length === 8 &&
      endToEndFixtures.length === 1,
    "formative_conversation_v18_case_type_inventory_invalid"
  );

  const historicalBudget = {
    expected_logical_call_count: 21,
    maximum_logical_call_count: 29,
    expected_provider_attempt_count: 21,
    maximum_provider_attempt_count: 87,
    maximum_semantic_regenerations_per_agent_call: 1,
    maximum_semantic_regeneration_count: 8,
    maximum_transport_retries_per_logical_call: 2,
    maximum_input_token_count: 900_000,
    maximum_output_token_count: 101_500,
    maximum_total_token_count: 1_001_500,
    maximum_wall_clock_duration_ms: 7_200_000,
    maximum_concurrency: 1,
    maximum_cost_usd: 30,
    pricing_metadata_status: "unavailable",
    cost_enforcement:
      "operator_ceiling_required_actual_estimate_recorded_when_available"
  } as const;
  const historicalPlan = compileFormativeV16Plan({
    runtime_candidate_hash: input.runtime_candidate_hash,
    evaluation_protocol_hash: input.evaluation_protocol_hash,
    runner_implementation_hash: input.runner_implementation_hash,
    live_environment_contract_hash: input.live_environment_contract_hash,
    fixture_manifest_hash: input.fixture_manifest_hash,
    aggregate_fixture_hash: stableHash(
      formativeFixtures.map((fixture) => fixture.formative_fixture.fixture_hash)
    ),
    fixtures: formativeFixtures.map((fixture) => fixture.formative_fixture),
    fixture_file_sha256_by_case: Object.fromEntries(
      formativeFixtures.map((fixture) => [
        fixture.case_id,
        fixture.source_fixture_sha256
      ])
    ),
    budget: historicalBudget,
    run_namespace_template: "<provider_run_id>",
    case_namespace_template: "<provider_run_id>:<case_id>",
    intended_artifacts: FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS
  });

  const profilingCases = profilingFixtures.map((fixture) => ({
    compiled_case_version: "formative-conversation-v18-compiled-case-v2" as const,
    case_type: fixture.case_type,
    case_id: fixture.case_id,
    case_order: fixture.case_order,
    title: fixture.title,
    fixture_hash: fixture.fixture_hash,
    fixture_file_sha256:
      input.fixture_file_sha256_by_case[fixture.case_id] ?? "",
    namespace: namespaceFor(fixture),
    provider_input: fixture.provider_input,
    catalog_identity_scope_template: fixture.catalog_identity_scope_template,
    expected_catalog: fixture.expected_catalog,
    case_assertions: fixture.case_assertions,
    call_graph: fixture.call_graph,
    compilation_status: "compiled" as const
  }));
  const formativeCases = formativeFixtures.map((fixture, index) => ({
    compiled_case_version: "formative-conversation-v18-compiled-case-v2" as const,
    case_type: fixture.case_type,
    case_id: fixture.case_id,
    case_order: fixture.case_order,
    title: fixture.formative_fixture.title,
    fixture_hash: fixture.fixture_hash,
    fixture_file_sha256:
      input.fixture_file_sha256_by_case[fixture.case_id] ?? "",
    source_fixture_path: fixture.source_fixture_path,
    source_fixture_sha256: fixture.source_fixture_sha256,
    canonical_identity_expectations: fixture.canonical_identity_expectations,
    namespace: namespaceFor(fixture),
    formative_case: historicalPlan.cases[index],
    compilation_status: "compiled" as const
  }));
  const endToEndCases = endToEndFixtures.map((fixture) => ({
    compiled_case_version: "formative-conversation-v18-compiled-case-v2" as const,
    case_type: fixture.case_type,
    case_id: fixture.case_id,
    case_order: fixture.case_order,
    title: fixture.title,
    fixture_hash: fixture.fixture_hash,
    fixture_file_sha256:
      input.fixture_file_sha256_by_case[fixture.case_id] ?? "",
    namespace: namespaceFor(fixture),
    execution_subject_id: fixture.execution_subject_id,
    assessment: fixture.assessment,
    assessment_responses: fixture.assessment_responses,
    student_messages: fixture.student_messages,
    initial_claim_expectations: fixture.initial_claim_expectations,
    required_pipeline: fixture.required_pipeline,
    case_assertions: fixture.case_assertions,
    permitted_terminal_outcomes: fixture.permitted_terminal_outcomes,
    call_graph: fixture.call_graph,
    compilation_status: "compiled" as const
  }));

  assertCondition(
    profilingFixtures.map((fixture) => fixture.case_id).join(",") ===
        FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER.join(",") &&
      formativeFixtures.map((fixture) => fixture.case_id).join(",") ===
        FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER.join(",") &&
      endToEndFixtures.map((fixture) => fixture.case_id).join(",") ===
        FORMATIVE_CONVERSATION_V5_END_TO_END_CASE_ORDER.join(","),
    "formative_conversation_v18_subgraph_order_invalid"
  );

  const cases = [...profilingCases, ...formativeCases, ...endToEndCases];
  const isolatedNamespaces = cases.map(
    (compiledCase) => compiledCase.namespace.case_namespace_template
  );
  assertCondition(
    new Set(isolatedNamespaces).size === 12,
    "formative_conversation_v18_case_namespace_collision"
  );
  assertCondition(
    input.budget.profiling_contract_base_call_count === 3 &&
      input.budget.formative_comparability_base_call_count === 21 &&
      input.budget.end_to_end_base_call_count === 4 &&
      input.budget.base_profiling_call_count === 4 &&
      input.budget.base_formative_call_count === 24 &&
      input.budget.expected_logical_call_count === 28 &&
      input.budget.maximum_logical_call_count === 56 &&
      input.budget.maximum_provider_attempt_count === 168 &&
      input.budget.maximum_provider_attempt_count ===
        input.budget.maximum_logical_call_count * 3,
    "formative_conversation_v18_compiled_budget_invalid"
  );

  const hashable = {
    compiled_plan_version: "formative-conversation-v18-compiled-plan-v2" as const,
    compilation_status: "ready_for_dispatch" as const,
    runtime_candidate_hash: input.runtime_candidate_hash,
    evaluation_protocol_hash: input.evaluation_protocol_hash,
    runner_implementation_hash: input.runner_implementation_hash,
    live_environment_contract_hash: input.live_environment_contract_hash,
    fixture_manifest_hash: input.fixture_manifest_hash,
    aggregate_fixture_hash: input.aggregate_fixture_hash,
    fixed_case_order: [...FORMATIVE_CONVERSATION_V5_CASE_ORDER],
    cases,
    aggregate_call_graph: {
      profiling_contract_base_call_count: 3 as const,
      formative_comparability_opening_call_count: 8 as const,
      formative_comparability_student_message_call_count: 13 as const,
      formative_comparability_base_call_count: 21 as const,
      end_to_end_profiling_base_call_count: 1 as const,
      end_to_end_opening_call_count: 1 as const,
      end_to_end_student_message_call_count: 2 as const,
      end_to_end_formative_base_call_count: 3 as const,
      end_to_end_base_call_count: 4 as const,
      expected_base_call_count: 28 as const,
      maximum_semantic_regeneration_count: 28 as const,
      maximum_logical_call_count: 56 as const,
      maximum_provider_attempt_count: 168 as const
    },
    budget: input.budget,
    isolated_namespaces: isolatedNamespaces,
    intended_output_artifact_locations:
      FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS.map(
        (artifact) =>
          `${FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT}/<provider_run_id>/${artifact}`
      ),
    approval_inactive: true as const,
    activation_permitted: false as const,
    provider_calls_during_compilation: 0 as const,
    network_requests_to_provider_during_compilation: 0 as const
  };
  return FormativeConversationV18CompiledPlanSchema.parse({
    ...hashable,
    compiled_plan_hash: stableHash(hashable)
  });
}

export function assertFormativeConversationV18CompiledPlanHash(
  plan: FormativeConversationV18CompiledPlan
) {
  const { compiled_plan_hash: expected, ...hashable } = plan;
  if (stableHash(hashable) !== expected) {
    throw new Error("formative_conversation_v18_compiled_plan_hash_mismatch");
  }
}

export function assertFormativeConversationV18CompilationParity(input: {
  committed: FormativeConversationV18CompiledPlan;
  compiled: FormativeConversationV18CompiledPlan;
}) {
  assertFormativeConversationV18CompiledPlanHash(input.committed);
  assertFormativeConversationV18CompiledPlanHash(input.compiled);
  if (
    input.committed.compiled_plan_hash !== input.compiled.compiled_plan_hash ||
    stableHash(input.committed) !== stableHash(input.compiled)
  ) {
    throw new Error("formative_conversation_v18_plan_live_compilation_mismatch");
  }
}
