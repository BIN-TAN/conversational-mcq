import { stableHash } from "@/lib/operational/stable-hash";
import { compileFormativeConversationV5ExecutionPlan as compileFormativeV16Plan } from "../formative-conversation-v5-evaluation-v16/compiler";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS,
  FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
  FormativeConversationV17CompiledPlanSchema,
  FormativeConversationV17FixtureSchema,
  type FormativeConversationV17Budget,
  type FormativeConversationV17CompiledPlan,
  type FormativeConversationV17Fixture
} from "./contracts";

export type FormativeConversationV17CompilationInput = {
  runtime_candidate_hash: string;
  evaluation_protocol_hash: string;
  runner_implementation_hash: string;
  live_environment_contract_hash: string;
  fixture_manifest_hash: string;
  aggregate_fixture_hash: string;
  fixtures: readonly unknown[];
  fixture_file_sha256_by_case: Readonly<Record<string, string>>;
  budget: FormativeConversationV17Budget;
};

function assertCondition(condition: unknown, code: string): asserts condition {
  if (!condition) {
    throw new Error(code);
  }
}

function compileProfilingCase(
  fixture: Extract<FormativeConversationV17Fixture, { case_type: "profiling_contract_canary" }>,
  fileSha256: string
) {
  const caseNamespace = `<provider_run_id>:${fixture.case_id}`;
  return {
    compiled_case_version: "formative-conversation-v17-compiled-case-v1" as const,
    case_type: fixture.case_type,
    case_id: fixture.case_id,
    case_order: fixture.case_order,
    title: fixture.title,
    fixture_hash: fixture.fixture_hash,
    fixture_file_sha256: fileSha256,
    namespace: {
      run_namespace_template: "<provider_run_id>" as const,
      case_namespace_template: caseNamespace,
      collision_check_key: stableHash({
        case_id: fixture.case_id,
        namespace: caseNamespace,
        input: fixture.provider_input
      })
    },
    provider_input: fixture.provider_input,
    catalog_identity_scope_template: fixture.catalog_identity_scope_template,
    expected_catalog: fixture.expected_catalog,
    case_assertions: fixture.case_assertions,
    call_graph: fixture.call_graph,
    compilation_status: "compiled" as const
  };
}

export function compileFormativeConversationV17ExecutionPlan(
  input: FormativeConversationV17CompilationInput
) {
  const fixtures = input.fixtures.map((fixture) =>
    FormativeConversationV17FixtureSchema.parse(fixture)
  );
  assertCondition(
    fixtures.length === FORMATIVE_CONVERSATION_V5_CASE_ORDER.length &&
      fixtures.every(
        (fixture, index) =>
          fixture.case_id === FORMATIVE_CONVERSATION_V5_CASE_ORDER[index] &&
          fixture.case_order === index + 1
      ),
    "formative_conversation_v17_case_inventory_or_order_invalid"
  );

  const profilingFixtures = fixtures.filter(
    (fixture): fixture is Extract<
      FormativeConversationV17Fixture,
      { case_type: "profiling_contract_canary" }
    > => fixture.case_type === "profiling_contract_canary"
  );
  const formativeFixtures = fixtures.filter(
    (fixture): fixture is Extract<
      FormativeConversationV17Fixture,
      { case_type: "formative_conversation" }
    > => fixture.case_type === "formative_conversation"
  );
  assertCondition(
    profilingFixtures.length === 3 && formativeFixtures.length === 8,
    "formative_conversation_v17_case_type_inventory_invalid"
  );

  const v16Budget = {
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
  const v16Plan = compileFormativeV16Plan({
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
        fixture.source_v16_fixture_sha256
      ])
    ),
    budget: v16Budget,
    run_namespace_template: "<provider_run_id>",
    case_namespace_template:
      "<provider_run_id>:<case_id>",
    intended_artifacts: FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS
  });

  const profilingCases = profilingFixtures.map((fixture) =>
    compileProfilingCase(
      fixture,
      input.fixture_file_sha256_by_case[fixture.case_id] ?? ""
    )
  );
  const formativeCases = formativeFixtures.map((fixture, index) => ({
    compiled_case_version: "formative-conversation-v17-compiled-case-v1" as const,
    case_type: "formative_conversation" as const,
    case_id: fixture.case_id,
    case_order: fixture.case_order,
    title: fixture.formative_fixture.title,
    fixture_hash: fixture.fixture_hash,
    fixture_file_sha256:
      input.fixture_file_sha256_by_case[fixture.case_id] ?? "",
    source_v16_fixture_sha256: fixture.source_v16_fixture_sha256,
    namespace: {
      run_namespace_template: "<provider_run_id>" as const,
      case_namespace_template: `<provider_run_id>:${fixture.case_id}`,
      collision_check_key: stableHash({
        case_id: fixture.case_id,
        fixture_hash: fixture.fixture_hash,
        source_v16_fixture_sha256: fixture.source_v16_fixture_sha256
      })
    },
    formative_case: v16Plan.cases[index],
    compilation_status: "compiled" as const
  }));
  assertCondition(
    profilingFixtures.map((fixture) => fixture.case_id).join(",") ===
      FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER.join(",") &&
      formativeFixtures.map((fixture) => fixture.case_id).join(",") ===
        FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER.join(","),
    "formative_conversation_v17_subgraph_order_invalid"
  );

  const cases = [...profilingCases, ...formativeCases];
  const isolatedNamespaces = cases.map(
    (compiledCase) => compiledCase.namespace.case_namespace_template
  );
  assertCondition(
    new Set(isolatedNamespaces).size === 11,
    "formative_conversation_v17_case_namespace_collision"
  );
  assertCondition(
    input.budget.base_profiling_call_count === 3 &&
      input.budget.base_formative_call_count === 21 &&
      input.budget.expected_logical_call_count === 24 &&
      input.budget.maximum_logical_call_count === 35 &&
      input.budget.maximum_provider_attempt_count === 105 &&
      input.budget.maximum_provider_attempt_count ===
        input.budget.maximum_logical_call_count * 3,
    "formative_conversation_v17_compiled_budget_invalid"
  );

  const hashable = {
    compiled_plan_version: "formative-conversation-v17-compiled-plan-v1" as const,
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
      profiling_base_call_count: 3 as const,
      formative_opening_call_count: 8 as const,
      formative_student_message_call_count: 13 as const,
      formative_base_call_count: 21 as const,
      expected_base_call_count: 24 as const,
      maximum_semantic_regeneration_count: 11 as const,
      maximum_logical_call_count: 35 as const,
      maximum_provider_attempt_count: 105 as const
    },
    budget: input.budget,
    isolated_namespaces: isolatedNamespaces,
    intended_output_artifact_locations:
      FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS.map((artifact) =>
        `${FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT}/<provider_run_id>/${artifact}`
      ),
    approval_inactive: true as const,
    activation_permitted: false as const,
    provider_calls_during_compilation: 0 as const,
    network_requests_to_provider_during_compilation: 0 as const
  };
  return FormativeConversationV17CompiledPlanSchema.parse({
    ...hashable,
    compiled_plan_hash: stableHash(hashable)
  });
}

export function assertFormativeConversationV17CompiledPlanHash(
  plan: FormativeConversationV17CompiledPlan
) {
  const { compiled_plan_hash: expected, ...hashable } = plan;
  if (stableHash(hashable) !== expected) {
    throw new Error("formative_conversation_v17_compiled_plan_hash_mismatch");
  }
}

export function assertFormativeConversationV17CompilationParity(input: {
  committed: FormativeConversationV17CompiledPlan;
  compiled: FormativeConversationV17CompiledPlan;
}) {
  assertFormativeConversationV17CompiledPlanHash(input.committed);
  assertFormativeConversationV17CompiledPlanHash(input.compiled);
  if (
    input.committed.compiled_plan_hash !== input.compiled.compiled_plan_hash ||
    stableHash(input.committed) !== stableHash(input.compiled)
  ) {
    throw new Error("formative_conversation_v17_plan_live_compilation_mismatch");
  }
}
