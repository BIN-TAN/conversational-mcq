import { stableHash } from "@/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
  FormativeConversationV5CompiledCaseSchema,
  FormativeConversationV5CompiledPlanSchema,
  FormativeConversationV5FixtureSchema,
  type FormativeConversationV5CompiledPlan,
  type FormativeConversationV5Fixture
} from "./contracts";

const CONSUMED_FIXTURE_FIELDS = [
  "assessment",
  "assessment_responses",
  "call_graph",
  "case_assertions",
  "case_id",
  "case_order",
  "execution_case_type",
  "execution_subject_id",
  "expected_logical_call_count",
  "expected_outcome_in_runtime_input",
  "expected_student_message_count",
  "fixture_hash",
  "fixture_version",
  "initial_profile_source",
  "opening_executed",
  "observable_process_telemetry_policy",
  "permitted_terminal_outcomes",
  "real_student_information_present",
  "required_provenance",
  "student_messages",
  "synthetic_identity",
  "synthetic_only",
  "terminal_execution_point",
  "title"
] as const;

type Budget = FormativeConversationV5CompiledPlan["budget"];

export type FormativeConversationV5CompilationInput = {
  runtime_candidate_hash: string;
  evaluation_protocol_hash: string;
  runner_implementation_hash: string;
  live_environment_contract_hash: string;
  fixture_manifest_hash: string;
  aggregate_fixture_hash: string;
  fixtures: readonly unknown[];
  fixture_file_sha256_by_case: Readonly<Record<string, string>>;
  budget: Budget;
  run_namespace_template: string;
  case_namespace_template: string;
  intended_artifacts: readonly string[];
};

function assertCondition(
  condition: unknown,
  code: string
): asserts condition {
  if (!condition) {
    throw new Error(code);
  }
}

function compiledPlanHash(
  plan: Omit<FormativeConversationV5CompiledPlan, "compiled_plan_hash">
) {
  return stableHash(plan);
}

function compileCase(input: {
  fixture: FormativeConversationV5Fixture;
  fixture_file_sha256: string;
  run_namespace_template: string;
  case_namespace_template: string;
}) {
  const { fixture } = input;
  const fixtureFields = Object.keys(fixture).sort();
  assertCondition(
    JSON.stringify(fixtureFields) ===
      JSON.stringify([...CONSUMED_FIXTURE_FIELDS].sort()),
    `${fixture.case_id}:fixture_field_not_consumed`
  );

  const studentMessageInputs = fixture.student_messages.map(
    (message) => ({
      service:
        "processFormativeConversationStudentMessage" as const,
      sequence: message.sequence,
      client_message_id_template: [
        "<provider_run_id>",
        fixture.case_id,
        "message",
        String(message.sequence)
      ].join(":"),
      conversation_public_id_binding:
        "persisted_formative_conversation_public_id" as const,
      student_user_db_id_binding:
        "persisted_synthetic_student_user_db_id" as const,
      message_text: message.message_text,
      intent_fixture_metadata: message.intent,
      observable_input_telemetry: {
        ...message.observable_input_telemetry,
        timestamp_binding:
          "derive_turn_and_typing_timestamps_at_submission" as const
      }
    })
  );
  const actualMessageCount = studentMessageInputs.length;
  const expectedLogicalCallCount = 1 + actualMessageCount;
  assertCondition(
    fixture.expected_student_message_count ===
      actualMessageCount &&
      fixture.call_graph.student_message_count ===
        actualMessageCount,
    `${fixture.case_id}:declared_actual_student_message_count_mismatch`
  );
  assertCondition(
    fixture.expected_logical_call_count ===
      expectedLogicalCallCount &&
      fixture.call_graph.expected_logical_calls ===
        expectedLogicalCallCount &&
      fixture.call_graph.maximum_logical_calls ===
        expectedLogicalCallCount + 1,
    `${fixture.case_id}:declared_actual_logical_call_count_mismatch`
  );

  const caseNamespace = input.case_namespace_template
    .replaceAll("<case_id>", fixture.case_id)
    .replaceAll(
      "<execution_subject_id>",
      fixture.execution_subject_id
    );
  assertCondition(
    caseNamespace.includes("<provider_run_id>") &&
      fixture.synthetic_identity.namespace_template ===
        caseNamespace,
    `${fixture.case_id}:isolated_namespace_compilation_failed`
  );

  return FormativeConversationV5CompiledCaseSchema.parse({
    compiled_case_version:
      "formative-conversation-v5-compiled-case-v1",
    case_id: fixture.case_id,
    case_order: fixture.case_order,
    title: fixture.title,
    fixture_hash: fixture.fixture_hash,
    fixture_file_sha256: input.fixture_file_sha256,
    execution_case_type: fixture.execution_case_type,
    execution_subject_id: fixture.execution_subject_id,
    source_contract: {
      synthetic_only: fixture.synthetic_only,
      real_student_information_present:
        fixture.real_student_information_present,
      expected_outcome_in_runtime_input:
        fixture.expected_outcome_in_runtime_input,
      raw_observations_only:
        fixture.observable_process_telemetry_policy
          .raw_observations_only,
      inferred_behavior_fields_absent:
        fixture.observable_process_telemetry_policy
          .inferred_behavior_fields_absent
    },
    namespace: {
      run_namespace_template: input.run_namespace_template,
      case_namespace_template: caseNamespace,
      assessment_identity_template:
        fixture.synthetic_identity.assessment_identity_template,
      session_identity_template:
        fixture.synthetic_identity.session_identity_template,
      student_identity_template:
        fixture.synthetic_identity.student_identity_template,
      collision_check_key: stableHash({
        case_id: fixture.case_id,
        execution_subject_id: fixture.execution_subject_id,
        case_namespace: caseNamespace,
        session_identity:
          fixture.synthetic_identity.session_identity_template,
        student_identity:
          fixture.synthetic_identity.student_identity_template
      })
    },
    assessment_fixture_input: {
      assessment: fixture.assessment,
      responses: fixture.assessment_responses,
      telemetry_policy:
        fixture.observable_process_telemetry_policy
    },
    initial_profile_persistence_input: {
      production_schema_version:
        fixture.initial_profile_source.production_schema_version,
      generated_by_provider:
        fixture.initial_profile_source.generated_by_provider,
      evidence_consistency:
        fixture.initial_profile_source.evidence_consistency,
      profile: fixture.initial_profile_source.profile
    },
    opening_input_template: {
      service: "processFormativeConversationOpening",
      execute: fixture.opening_executed,
      conversation_public_id_binding:
        "persisted_formative_conversation_public_id",
      context_seed_service:
        "buildFormativeConversationRuntimeContextSeed",
      student_user_db_id_binding:
        "persisted_synthetic_student_user_db_id"
    },
    student_message_input_templates: studentMessageInputs,
    call_graph: {
      opening_executed: fixture.opening_executed,
      opening_call_count: 1,
      declared_student_message_count:
        fixture.expected_student_message_count,
      actual_student_message_count: actualMessageCount,
      student_message_call_count: actualMessageCount,
      profiling_call_count: 0,
      declared_expected_logical_call_count:
        fixture.expected_logical_call_count,
      expected_logical_call_count: expectedLogicalCallCount,
      maximum_logical_call_count:
        fixture.call_graph.maximum_logical_calls,
      logical_calls: fixture.call_graph.logical_calls,
      terminal_execution_point:
        fixture.terminal_execution_point,
      terminal_condition: fixture.call_graph.terminal_condition
    },
    evaluation_contract: {
      case_assertions: fixture.case_assertions,
      permitted_terminal_outcomes:
        fixture.permitted_terminal_outcomes,
      required_provenance: fixture.required_provenance,
      persistence_requirements:
        fixture.call_graph.persistence_requirements,
      evaluation_steps: fixture.call_graph.evaluation_steps
    },
    consumed_fixture_fields: fixtureFields,
    compilation_status: "compiled"
  });
}

export function compileFormativeConversationV5ExecutionPlan(
  input: FormativeConversationV5CompilationInput
) {
  const fixtures = input.fixtures.map((fixture) =>
    FormativeConversationV5FixtureSchema.parse(fixture)
  );
  assertCondition(
    fixtures.length === FORMATIVE_CONVERSATION_V5_CASE_ORDER.length,
    "formative_conversation_v5_v5_fixture_inventory_not_exact"
  );
  assertCondition(
    fixtures.every(
      (fixture, index) =>
        fixture.case_id ===
          FORMATIVE_CONVERSATION_V5_CASE_ORDER[index] &&
        fixture.case_order === index + 1
    ),
    "formative_conversation_v5_v5_case_order_mismatch"
  );
  assertCondition(
    new Set(
      fixtures.map((fixture) => fixture.execution_subject_id)
    ).size === fixtures.length,
    "formative_conversation_v5_v5_execution_subject_collision"
  );
  const assessmentHashes = new Set(
    fixtures.map((fixture) => stableHash(fixture.assessment))
  );
  assertCondition(
    assessmentHashes.size === 1,
    "formative_conversation_v5_v5_assessment_definition_mismatch"
  );

  const cases = fixtures.map((fixture) =>
    compileCase({
      fixture,
      fixture_file_sha256:
        input.fixture_file_sha256_by_case[fixture.case_id] ?? "",
      run_namespace_template: input.run_namespace_template,
      case_namespace_template: input.case_namespace_template
    })
  );
  const isolatedNamespaces = cases.map(
    (entry) => entry.namespace.case_namespace_template
  );
  assertCondition(
    new Set(isolatedNamespaces).size === isolatedNamespaces.length,
    "formative_conversation_v5_v5_case_namespace_collision"
  );

  const openingCallCount = cases.reduce(
    (total, entry) =>
      total + entry.call_graph.opening_call_count,
    0
  );
  const studentMessageCallCount = cases.reduce(
    (total, entry) =>
      total + entry.call_graph.student_message_call_count,
    0
  );
  const expectedLogicalCallCount = cases.reduce(
    (total, entry) =>
      total + entry.call_graph.expected_logical_call_count,
    0
  );
  const maximumLogicalCallCount = cases.reduce(
    (total, entry) =>
      total + entry.call_graph.maximum_logical_call_count,
    0
  );
  assertCondition(
    openingCallCount === 8 &&
      studentMessageCallCount === 13 &&
      expectedLogicalCallCount ===
        input.budget.expected_logical_call_count &&
      maximumLogicalCallCount ===
        input.budget.maximum_logical_call_count &&
      input.budget.maximum_provider_attempt_count ===
        maximumLogicalCallCount *
          (input.budget
            .maximum_transport_retries_per_logical_call +
            1),
    "formative_conversation_v5_v5_aggregate_call_graph_mismatch"
  );

  const hashable = {
    compiled_plan_version:
      "formative-conversation-v5-compiled-execution-plan-v1" as const,
    compilation_status: "ready_for_dispatch" as const,
    runtime_candidate_hash: input.runtime_candidate_hash,
    evaluation_protocol_hash: input.evaluation_protocol_hash,
    runner_implementation_hash: input.runner_implementation_hash,
    live_environment_contract_hash:
      input.live_environment_contract_hash,
    fixture_manifest_hash: input.fixture_manifest_hash,
    aggregate_fixture_hash: input.aggregate_fixture_hash,
    fixed_case_order: [...FORMATIVE_CONVERSATION_V5_CASE_ORDER],
    cases,
    aggregate_call_graph: {
      opening_call_count: 8 as const,
      student_message_call_count: 13 as const,
      profiling_call_count: 0 as const,
      expected_logical_call_count: 21 as const,
      maximum_logical_call_count: 29 as const,
      maximum_provider_attempt_count: 87 as const
    },
    budget: input.budget,
    isolated_namespaces: isolatedNamespaces,
    intended_output_artifact_locations:
      input.intended_artifacts.map((artifact) =>
        [
          FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
          "<provider_run_id>",
          artifact
        ].join("/")
      ),
    approval_inactive: true as const,
    activation_permitted: false as const,
    provider_calls_during_compilation: 0 as const,
    network_requests_to_provider_during_compilation: 0 as const
  };
  return FormativeConversationV5CompiledPlanSchema.parse({
    ...hashable,
    compiled_plan_hash: compiledPlanHash(hashable)
  });
}

export function assertFormativeConversationV5CompiledPlanHash(
  plan: FormativeConversationV5CompiledPlan
) {
  const { compiled_plan_hash: expected, ...hashable } = plan;
  assertCondition(
    compiledPlanHash(hashable) === expected,
    "formative_conversation_v5_v5_compiled_plan_hash_mismatch"
  );
}

export function assertFormativeConversationV5CompilationParity(input: {
  committed: FormativeConversationV5CompiledPlan;
  compiled: FormativeConversationV5CompiledPlan;
}) {
  assertFormativeConversationV5CompiledPlanHash(input.committed);
  assertFormativeConversationV5CompiledPlanHash(input.compiled);
  assertCondition(
    input.committed.compiled_plan_hash ===
      input.compiled.compiled_plan_hash &&
      stableHash(input.committed) === stableHash(input.compiled),
    "formative_conversation_v5_v5_plan_live_compilation_mismatch"
  );
}
