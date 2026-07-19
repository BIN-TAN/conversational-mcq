import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkCustomStructuredOutputCompatibility } from
  "@/lib/agents/provider-schema-compat";
import {
  resolveOpenAICredentialFromEnv,
  withResolvedOpenAICredential
} from "@/lib/llm/openai-credential-resolver";
import {
  OpenAIResponsesProvider,
  withOpenAIResponsesTransportBoundaryObserver
} from "@/lib/llm/providers/openai-responses-provider";
import {
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMAS,
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS,
  TopicDialogueOperationSchema,
  buildTopicDialogueOperationRequestEnvelope
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";
import {
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS,
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
  buildTopicDialogueModeRequestEnvelope,
  type TopicDialogueResponseMode
} from "@/lib/services/student-assessment/topic-dialogue-response-mode";
import { productionRoleOutputContracts } from
  "./e2a4-structured-output-audit";
import { buildTopicDialogueModeProviderInput } from
  "./e2a7-topic-dialogue-mode-candidate";
import { e2a8CanaryCases } from "./e2a8-v6-topic-dialogue-protocol";
import {
  buildTopicDialogueOperationProviderInput,
  evaluateE2A9Candidate
} from "./e2a9-topic-dialogue-operation-candidate";
import { e2a9HeldOutOperationCases } from
  "./e2a9-topic-dialogue-operation-protocol";

export const E2A9_REQUEST_COMPILATION_VERSION =
  "e2a9-operation-specific-production-request-compilation-v1" as const;
export const E2A9_REQUEST_COMPILATION_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a9-topic-dialogue-request-compilation"
);

const forbiddenControlProperties = [
  "next_action",
  "recommended_action",
  "response_mode",
  "dialogue_operation",
  "response_function",
  "readiness",
  "progression_status",
  "runtime_state"
];

function schemaProperties(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const properties = (value as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }
  return Object.keys(properties);
}

export function buildE2A9SchemaAudit() {
  const operationResults = TopicDialogueOperationSchema.options.map(
    (operation) => {
      const schemaName = TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS[
        operation
      ].replace(/-/gu, "_");
      const result = checkCustomStructuredOutputCompatibility({
        schema: TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMAS[operation],
        schema_name: schemaName
      });
      const properties = schemaProperties(result.json_schema);
      const forbidden = forbiddenControlProperties.filter((property) =>
        properties.includes(property)
      );
      return {
        dialogue_operation: operation,
        output_schema_version:
          TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS[operation],
        compatible: result.compatible,
        schema_compiled: result.schema_compiled,
        formatter_issues: result.issues,
        top_level_property_names: properties,
        forbidden_provider_control_properties: forbidden,
        provider_control_fields_absent: forbidden.length === 0,
        compiled_json_schema: result.json_schema
      };
    }
  );
  const progressionModes: TopicDialogueResponseMode[] = [
    "request_revision",
    "present_transfer",
    "complete_episode"
  ];
  const progressionResults = progressionModes.map((mode) => {
    const result = checkCustomStructuredOutputCompatibility({
      schema: TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS[mode],
      schema_name: TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS[mode]
        .replace(/-/gu, "_")
    });
    return {
      response_mode: mode,
      output_schema_version: TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS[mode],
      compatible: result.compatible,
      schema_compiled: result.schema_compiled,
      formatter_issues: result.issues,
      compiled_json_schema: result.json_schema
    };
  });
  return {
    audit_version: "e2a9-operation-schema-audit-v1",
    operation_schema_count: operationResults.length,
    retained_progression_schema_count: progressionResults.length,
    all_operation_schemas_compile: operationResults.every((entry) =>
      entry.compatible
    ),
    all_retained_progression_schemas_compile: progressionResults.every(
      (entry) => entry.compatible
    ),
    all_provider_control_fields_absent: operationResults.every((entry) =>
      entry.provider_control_fields_absent
    ),
    operation_results: operationResults,
    retained_progression_results: progressionResults,
    network_request_count: 0
  };
}

function progressionCase(mode: TopicDialogueResponseMode) {
  const found = e2a8CanaryCases().find((entry) =>
    entry.selected_mode === mode
  );
  if (!found) throw new Error(`e2a9_progression_compilation_case_missing:${mode}`);
  return found;
}

export async function compileE2A9CandidateRequestsNoNetwork(
  outputPath = path.join(E2A9_REQUEST_COMPILATION_ROOT, "request-compilation.json")
) {
  const candidate = evaluateE2A9Candidate();
  const productionContracts = productionRoleOutputContracts(
    candidate.full_candidate,
    { correctedTopicDialogue: true }
  );
  const nonTopicContracts = productionContracts.filter((entry) =>
    entry.role !== "topic_dialogue_agent"
  );
  const credential = resolveOpenAICredentialFromEnv({
    ...process.env,
    OPENAI_API_KEY: "sk-e2a9-no-network-credential-000000000000",
    OPENAI_API_KEY_FILE: undefined
  });
  if (!credential.ok) throw new Error(`e2a9_test_credential_invalid:${credential.code}`);

  const originalAbortHook =
    process.env.OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY;
  const originalApprovedHash = process.env.OPERATIONAL_APPROVED_CONFIG_HASH;
  process.env.OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY = "true";
  process.env.OPERATIONAL_APPROVED_CONFIG_HASH = candidate.approved_v2_hash;
  const transportEvents: Array<{ role: string; event_type: string }> = [];
  try {
    const rows = await withResolvedOpenAICredential(
      credential.credential,
      () => withOpenAIResponsesTransportBoundaryObserver(
        (event) => {
          transportEvents.push({
            role: event.metadata?.audit_role ?? "unknown",
            event_type: event.event_type
          });
        },
        async () => {
          const provider = new OpenAIResponsesProvider();
          const results: Array<Record<string, unknown>> = [];
          for (const testCase of e2a9HeldOutOperationCases()) {
            const providerInput = buildTopicDialogueOperationProviderInput({
              dialogue_input: testCase.dialogue_input,
              selected_operation: testCase.operation,
              routing_classification: testCase.routing_classification,
              distractor_anchor: testCase.distractor_anchor,
              misconception_target: testCase.misconception_target,
              evidence_needed: testCase.evidence_needed,
              strategies_already_attempted: testCase.strategies_already_attempted,
              strategies_marked_unsuccessful:
                testCase.strategies_marked_unsuccessful
            });
            const envelope = buildTopicDialogueOperationRequestEnvelope({
              selected_response_mode: "remain_in_dialogue",
              selected_operation: testCase.operation,
              provider_input: providerInput,
              prompt_context: {
                latest_student_message:
                  providerInput.latest_student_message,
                distractor_anchor: testCase.distractor_anchor,
                misconception_or_partial_understanding_target:
                  testCase.misconception_target,
                evidence_needed: testCase.evidence_needed,
                strategies_already_attempted:
                  testCase.strategies_already_attempted,
                strategies_marked_unsuccessful:
                  testCase.strategies_marked_unsuccessful,
                visible_dialogue_history:
                  providerInput.visible_dialogue_history
              }
            });
            const result = await provider.executeStructured<unknown, unknown>({
              agent_name: "topic_dialogue_agent",
              model_config: candidate.full_candidate.roles.topic_dialogue_agent,
              instructions: envelope.instructions,
              input: envelope.provider_input,
              output_schema: envelope.output_schema,
              schema_name: envelope.schema_name,
              client_request_id: `e2a9_compile_operation_${testCase.operation}`,
              timeout_ms:
                candidate.full_candidate.runtime_policy.provider_timeout_ms,
              metadata: {
                purpose: "e2a9_no_live_operation_request_compilation",
                audit_role: "topic_dialogue_agent",
                selected_response_mode: "remain_in_dialogue",
                selected_dialogue_operation: testCase.operation,
                candidate_hash_prefix:
                  candidate.candidate_configuration_hash.slice(0, 12)
              }
            });
            results.push({
              role: "topic_dialogue_agent",
              selected_response_mode: "remain_in_dialogue",
              selected_dialogue_operation: testCase.operation,
              schema_name: envelope.schema_name,
              output_schema_version: envelope.output_schema_version,
              request_status: result.status,
              request_serialization_completed:
                result.transport_telemetry?.request_serialization_completed ?? false,
              fetch_invoked:
                result.transport_telemetry?.fetch_invoked ?? false,
              dispatch_boundary_reached:
                result.transport_telemetry?.request_serialization_completed === true &&
                result.transport_telemetry?.fetch_invoked === false,
              provider_operation_field_present: false
            });
          }
          for (const mode of [
            "request_revision",
            "present_transfer",
            "complete_episode"
          ] as const) {
            const testCase = progressionCase(mode);
            const providerInput = buildTopicDialogueModeProviderInput({
              dialogue_input: testCase.dialogue_input,
              selected_mode: mode
            });
            const envelope = buildTopicDialogueModeRequestEnvelope({
              authorization: testCase.dialogue_input.progression_authorization,
              provider_input: providerInput
            });
            const result = await provider.executeStructured<unknown, unknown>({
              agent_name: "topic_dialogue_agent",
              model_config: candidate.full_candidate.roles.topic_dialogue_agent,
              instructions: envelope.instructions,
              input: envelope.provider_input,
              output_schema: envelope.output_schema,
              schema_name: envelope.schema_name,
              client_request_id: `e2a9_compile_progression_${mode}`,
              timeout_ms:
                candidate.full_candidate.runtime_policy.provider_timeout_ms,
              metadata: {
                purpose: "e2a9_no_live_retained_progression_compilation",
                audit_role: "topic_dialogue_agent",
                selected_response_mode: mode,
                candidate_hash_prefix:
                  candidate.candidate_configuration_hash.slice(0, 12)
              }
            });
            results.push({
              role: "topic_dialogue_agent",
              selected_response_mode: mode,
              selected_dialogue_operation: null,
              schema_name: envelope.schema_name,
              output_schema_version: envelope.output_schema_version,
              request_status: result.status,
              request_serialization_completed:
                result.transport_telemetry?.request_serialization_completed ?? false,
              fetch_invoked:
                result.transport_telemetry?.fetch_invoked ?? false,
              dispatch_boundary_reached:
                result.transport_telemetry?.request_serialization_completed === true &&
                result.transport_telemetry?.fetch_invoked === false,
              provider_operation_field_present: false
            });
          }
          for (const contract of nonTopicContracts) {
            const result = await provider.executeStructured({
              agent_name: contract.role,
              model_config: candidate.full_candidate.roles[contract.role],
              instructions:
                "Compile this production output contract without dispatching a network request.",
              input: { synthetic_no_live_compilation: true },
              output_schema: contract.schema,
              schema_name: contract.schema_name,
              client_request_id: `e2a9_compile_${contract.role}`,
              timeout_ms:
                candidate.full_candidate.runtime_policy.provider_timeout_ms,
              metadata: {
                purpose: "e2a9_no_live_all_role_request_compilation",
                audit_role: contract.role,
                candidate_hash_prefix:
                  candidate.candidate_configuration_hash.slice(0, 12)
              }
            });
            results.push({
              role: contract.role,
              selected_response_mode: null,
              selected_dialogue_operation: null,
              schema_name: contract.schema_name,
              output_schema_version: contract.manifest_declared_schema_version,
              request_status: result.status,
              request_serialization_completed:
                result.transport_telemetry?.request_serialization_completed ?? false,
              fetch_invoked:
                result.transport_telemetry?.fetch_invoked ?? false,
              dispatch_boundary_reached:
                result.transport_telemetry?.request_serialization_completed === true &&
                result.transport_telemetry?.fetch_invoked === false,
              provider_operation_field_present: false
            });
          }
          return results;
        }
      )
    );
    const fetchEvents = transportEvents.filter((event) =>
      event.event_type === "fetch_invoked"
    );
    const uniqueRoles = [...new Set(rows.map((entry) => entry.role))];
    const schemaAudit = buildE2A9SchemaAudit();
    const artifact = {
      compilation_version: E2A9_REQUEST_COMPILATION_VERSION,
      generated_at: new Date().toISOString(),
      selected_candidate_hash: candidate.candidate_configuration_hash,
      role_count: uniqueRoles.length,
      request_count: rows.length,
      operation_request_count: 7,
      retained_progression_request_count: 3,
      all_operation_schemas_compile:
        schemaAudit.all_operation_schemas_compile,
      all_retained_progression_schemas_compile:
        schemaAudit.all_retained_progression_schemas_compile,
      provider_control_fields_absent:
        schemaAudit.all_provider_control_fields_absent,
      all_17_roles_compile: uniqueRoles.length === 17 &&
        rows.every((entry) => entry.dispatch_boundary_reached === true),
      provider_generation_call_count: fetchEvents.length,
      network_request_count: fetchEvents.length,
      unrelated_role_count: nonTopicContracts.length,
      unrelated_role_configuration_changed: false,
      role_results: rows
    };
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    return { outputPath, artifact, schemaAudit };
  } finally {
    if (originalAbortHook === undefined) {
      delete process.env.OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY;
    } else {
      process.env.OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY =
        originalAbortHook;
    }
    if (originalApprovedHash === undefined) {
      delete process.env.OPERATIONAL_APPROVED_CONFIG_HASH;
    } else {
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH = originalApprovedHash;
    }
  }
}
