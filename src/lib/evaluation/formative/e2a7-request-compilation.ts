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
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS,
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
  TopicDialogueResponseModeSchema,
  buildTopicDialogueModeRequestEnvelope,
  type TopicDialogueResponseMode
} from "@/lib/services/student-assessment/topic-dialogue-response-mode";
import { productionRoleOutputContracts } from
  "./e2a4-structured-output-audit";
import {
  buildTopicDialogueModeProviderInput,
  evaluateE2A7Candidate
} from "./e2a7-topic-dialogue-mode-candidate";
import { e2a6DispatchCanaryCases } from
  "./e2a6-v5-topic-dialogue-protocol";

export const E2A7_REQUEST_COMPILATION_VERSION =
  "e2a7-mode-specific-production-request-compilation-v1" as const;
export const E2A7_REQUEST_COMPILATION_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a7-topic-dialogue-request-compilation"
);

const forbiddenProviderActionProperties = [
  "next_action",
  "recommended_action",
  "next_runtime_state",
  "progression_readiness",
  "ready_to_advance",
  "show_progression_choices",
  "show_final_support_options",
  "sufficient_to_advance"
];

function schemaProperties(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const properties = (value as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }
  return Object.keys(properties);
}

export function buildE2A7ModeSchemaAudit() {
  const modeResults = TopicDialogueResponseModeSchema.options.map((mode) => {
    const result = checkCustomStructuredOutputCompatibility({
      schema: TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS[mode],
      schema_name: TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS[mode]
        .replace(/-/gu, "_")
    });
    const properties = schemaProperties(result.json_schema);
    const forbidden = forbiddenProviderActionProperties.filter((name) =>
      properties.includes(name)
    );
    return {
      response_mode: mode,
      output_schema_version: TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS[mode],
      compatible: result.compatible,
      schema_compiled: result.schema_compiled,
      formatter_issues: result.issues,
      top_level_property_names: properties,
      forbidden_provider_action_properties: forbidden,
      provider_action_recommendation_absent: forbidden.length === 0,
      compiled_json_schema: result.json_schema
    };
  });
  return {
    audit_version: "e2a7-mode-specific-schema-audit-v1",
    mode_count: modeResults.length,
    all_mode_schemas_compile: modeResults.every((entry) => entry.compatible),
    all_provider_action_fields_absent: modeResults.every((entry) =>
      entry.provider_action_recommendation_absent
    ),
    mode_results: modeResults,
    network_request_count: 0
  };
}

function caseForMode(mode: TopicDialogueResponseMode) {
  const testCase = e2a6DispatchCanaryCases().find((entry) =>
    entry.expected_authorized_action === mode
  );
  if (!testCase) throw new Error(`e2a7_compilation_case_missing:${mode}`);
  return testCase;
}

export async function compileE2A7CandidateRequestsNoNetwork(
  outputPath = path.join(E2A7_REQUEST_COMPILATION_ROOT, "request-compilation.json")
) {
  const candidate = evaluateE2A7Candidate();
  const productionContracts = productionRoleOutputContracts(
    candidate.full_candidate,
    { correctedTopicDialogue: true }
  );
  const nonTopicContracts = productionContracts.filter((entry) =>
    entry.role !== "topic_dialogue_agent"
  );
  const credential = resolveOpenAICredentialFromEnv({
    ...process.env,
    OPENAI_API_KEY: "sk-e2a7-no-network-credential-000000000000",
    OPENAI_API_KEY_FILE: undefined
  });
  if (!credential.ok) throw new Error(`e2a7_test_credential_invalid:${credential.code}`);

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
          for (const mode of TopicDialogueResponseModeSchema.options) {
            const testCase = caseForMode(mode);
            const providerInput = buildTopicDialogueModeProviderInput({
              dialogue_input: testCase.input,
              selected_mode: mode
            });
            const envelope = buildTopicDialogueModeRequestEnvelope({
              authorization: testCase.input.progression_authorization,
              provider_input: providerInput
            });
            const result = await provider.executeStructured<unknown, unknown>({
              agent_name: "topic_dialogue_agent",
              model_config: candidate.full_candidate.roles.topic_dialogue_agent,
              instructions: envelope.instructions,
              input: envelope.provider_input,
              output_schema: envelope.output_schema,
              schema_name: envelope.schema_name,
              client_request_id: `e2a7_compile_topic_dialogue_${mode}`,
              timeout_ms: candidate.full_candidate.runtime_policy.provider_timeout_ms,
              metadata: {
                purpose: "e2a7_no_live_mode_request_compilation",
                audit_role: "topic_dialogue_agent",
                selected_response_mode: mode,
                candidate_hash_prefix:
                  candidate.candidate_configuration_hash.slice(0, 12)
              }
            });
            results.push({
              role: "topic_dialogue_agent",
              selected_response_mode: mode,
              schema_name: envelope.schema_name,
              output_schema_version: envelope.output_schema_version,
              request_status: result.status,
              request_serialization_completed:
                result.transport_telemetry?.request_serialization_completed ?? false,
              fetch_invoked: result.transport_telemetry?.fetch_invoked ?? false,
              dispatch_boundary_reached:
                result.transport_telemetry?.request_serialization_completed === true &&
                result.transport_telemetry?.fetch_invoked === false,
              provider_action_field_present: false
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
              client_request_id: `e2a7_compile_${contract.role}`,
              timeout_ms: candidate.full_candidate.runtime_policy.provider_timeout_ms,
              metadata: {
                purpose: "e2a7_no_live_all_role_request_compilation",
                audit_role: contract.role,
                candidate_hash_prefix:
                  candidate.candidate_configuration_hash.slice(0, 12)
              }
            });
            results.push({
              role: contract.role,
              selected_response_mode: null,
              schema_name: contract.schema_name,
              output_schema_version: contract.manifest_declared_schema_version,
              request_status: result.status,
              request_serialization_completed:
                result.transport_telemetry?.request_serialization_completed ?? false,
              fetch_invoked: result.transport_telemetry?.fetch_invoked ?? false,
              dispatch_boundary_reached:
                result.transport_telemetry?.request_serialization_completed === true &&
                result.transport_telemetry?.fetch_invoked === false,
              provider_action_field_present: false
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
    const modeSchemaAudit = buildE2A7ModeSchemaAudit();
    const artifact = {
      compilation_version: E2A7_REQUEST_COMPILATION_VERSION,
      generated_at: new Date().toISOString(),
      selected_candidate_hash: candidate.candidate_configuration_hash,
      role_count: uniqueRoles.length,
      request_count: rows.length,
      topic_dialogue_mode_request_count: 4,
      all_four_mode_schemas_compile: modeSchemaAudit.all_mode_schemas_compile,
      provider_action_recommendation_absent:
        modeSchemaAudit.all_provider_action_fields_absent,
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
    return { outputPath, artifact, modeSchemaAudit };
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
