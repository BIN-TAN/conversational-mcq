import { loadEnvConfig } from "@next/env";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER
} from "../src/lib/operational/formative-conversation-v5-evaluation-v6/contracts";
import {
  compileFormativeConversationV5PreDispatch
} from "../src/lib/operational/formative-conversation-v5-evaluation-v6/service";
import {
  installFormativeConversationV5TestEnvironment
} from "./helpers/formative-conversation-v5-v6-test-environment";

loadEnvConfig(process.cwd());

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function deterministicResearchExportReadiness() {
  return {
    ready: true,
    environment: "production",
    pseudonymization_method: "HMAC-SHA-256" as const,
    pseudonymization_version: "hmac_sha256_v1",
    key_configured: true,
    safe_key_fingerprint: null,
    required_configuration: ["RESEARCH_PSEUDONYMIZATION_KEY"],
    blocking_reasons: [],
    warnings: [],
    export_schema_version: "deterministic-test-export-schema",
    readiness_version: "research-export-readiness-v1" as const,
    artifact_path_writable: true,
    database_ready: true,
    dictionary_registry_ready: true,
    restricted_export_authorization_supported: true
  };
}

async function main() {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment =
    installFormativeConversationV5TestEnvironment();
  let providerNetworkRequests = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (/api\.openai\.com/iu.test(url)) {
      providerNetworkRequests += 1;
      throw new Error(
        "formative_conversation_v5_v5_provider_call_forbidden"
      );
    }
    return originalFetch(input);
  }) as typeof fetch;

  try {
    const preDispatch =
      await compileFormativeConversationV5PreDispatch({
        get_research_export_readiness:
          deterministicResearchExportReadiness
      });
    const { loaded, plan } = preDispatch;
    const expectedMessageCounts = [0, 2, 1, 1, 2, 2, 3, 2];
    const expectedLogicalCalls = [1, 3, 2, 2, 3, 3, 4, 3];

    assert(
      loaded.compiled_plan.cases.length === 8,
      "All eight frozen cases must compile."
    );
    assert(
      preDispatch.runtime_inputs.subjects.length === 8 &&
        preDispatch.runtime_inputs.subjects.every(
          (subject, index) =>
            subject.subject_id ===
              loaded.compiled_plan.cases[index]
                .execution_subject_id &&
            subject.conversation_behavior.length ===
              expectedMessageCounts[index]
        ) &&
        Object.keys(
          preDispatch.runtime_inputs.frozen_initial_profiles
        ).length === 8 &&
        preDispatch.runtime_inputs.assessment_definition
          .administered_items.length === 3 &&
        !preDispatch.runtime_inputs.include_production_profiling &&
        preDispatch.runtime_inputs.runtime_input_hash.length === 64,
      "All fixtures must compile through the exact live runtime-input conversion."
    );
    assert(
      JSON.stringify(
        loaded.compiled_plan.cases.map((entry) => entry.case_id)
      ) === JSON.stringify(FORMATIVE_CONVERSATION_V5_CASE_ORDER),
      "Compiled case order must match the frozen protocol."
    );
    assert(
      loaded.compiled_plan.cases.every(
        (entry, index) =>
          entry.compilation_status === "compiled" &&
          entry.call_graph.declared_student_message_count ===
            expectedMessageCounts[index] &&
          entry.call_graph.actual_student_message_count ===
            expectedMessageCounts[index] &&
          entry.call_graph.expected_logical_call_count ===
            expectedLogicalCalls[index] &&
          entry.assessment_fixture_input.assessment.administered_items
            .length > 0 &&
          entry.assessment_fixture_input.responses.length > 0 &&
          entry.initial_profile_persistence_input.profile !== null &&
          entry.opening_input_template.service ===
            "processFormativeConversationOpening" &&
          entry.student_message_input_templates.every(
            (message) =>
              message.service ===
                "processFormativeConversationStudentMessage" &&
              message.message_text.trim().length > 0
          )
      ),
      "Each case must compile into complete production-service input templates."
    );
    assert(
      loaded.compiled_plan.cases[0].student_message_input_templates
        .length === 0 &&
        loaded.compiled_plan.cases[2]
          .student_message_input_templates.length === 1 &&
        loaded.compiled_plan.cases[3]
          .student_message_input_templates.length === 1,
      "Opening-only and single-message cases must retain exact counts."
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
      "Compiled aggregate call graph must match the frozen budget."
    );
    assert(
      new Set(loaded.compiled_plan.isolated_namespaces).size === 8 &&
        loaded.compiled_plan.isolated_namespaces.every((namespace) =>
          namespace.includes("<provider_run_id>")
        ),
      "Every compiled case must use a distinct synthetic namespace."
    );
    assert(
      preDispatch.readiness.database_ready &&
        preDispatch.readiness.research_export_ready &&
        preDispatch.readiness.research_key_configured &&
        preDispatch.readiness.artifact_path_writable &&
        preDispatch.readiness.dictionary_registry_ready,
      "Database and research-export readiness must pass."
    );
    assert(
      preDispatch.readiness.live_environment
        .application_readiness.llm_runtime_resolved &&
        preDispatch.readiness.live_environment
          .application_readiness.operational_integration_resolved &&
        preDispatch.readiness.live_environment
          .inactive_candidate.runtime_candidate_hash ===
          loaded.runtime_candidate_hash &&
        preDispatch.readiness.live_environment.active_approval
          .runtime_candidate_hash !== loaded.runtime_candidate_hash,
      "The exact live child environment must resolve application readiness while keeping active approval and inactive candidate separate."
    );
    assert(
      preDispatch.dispatch_boundary.status ===
        "ready_immediately_before_dispatch_checkpoint" &&
        !preDispatch.dispatch_boundary.checkpoint_created &&
        preDispatch.dispatch_boundary.provider_calls === 0,
      "Compilation must stop immediately before checkpoint creation."
    );
    assert(
      plan.provider_calls === 0 &&
        plan.provider_network_requests === 0 &&
        plan.compiled_execution_plan.compilation_status ===
          "ready_for_dispatch",
      "Plan/live shared compilation must remain no-provider."
    );
    assert(
      providerNetworkRequests === 0,
      "The compilation smoke must not contact OpenAI."
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          case_count: loaded.compiled_plan.cases.length,
          case_order: FORMATIVE_CONVERSATION_V5_CASE_ORDER,
          student_message_counts: expectedMessageCounts,
          logical_call_counts: expectedLogicalCalls,
          aggregate_logical_calls: 21,
          maximum_provider_attempts: 63,
          dispatch_boundary:
            preDispatch.dispatch_boundary.status,
          checkpoint_created: false,
          provider_calls: 0,
          provider_network_requests: providerNetworkRequests,
          database_ready:
            preDispatch.readiness.database_ready,
          database_probe_mode: "deterministic",
          research_export_ready:
            preDispatch.readiness.research_export_ready,
          compiled_plan_hash:
            loaded.compiled_plan.compiled_plan_hash
        },
        null,
        2
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message.split(":", 1)[0]
          : "formative_conversation_v5_v5_compilation_smoke_failed",
      provider_calls: 0,
      secrets_printed: false
    })
  );
  process.exitCode = 1;
});
