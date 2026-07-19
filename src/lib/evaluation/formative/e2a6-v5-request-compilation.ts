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
  E2A5_TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
  evaluateE2A5Candidate
} from "./e2a5-topic-dialogue-progression-contract";
import { productionRoleOutputContracts } from "./e2a4-structured-output-audit";
import { e2a6DispatchCanaryCases } from "./e2a6-v5-topic-dialogue-protocol";

export const E2A6_REQUEST_COMPILATION_VERSION =
  "e2a6-v5-production-request-compilation-v1" as const;

export const E2A6_REQUEST_COMPILATION_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a6-v5-request-compilation"
);

export function buildE2A6AllRoleSchemaAudit() {
  const candidate = evaluateE2A5Candidate();
  const contracts = productionRoleOutputContracts(candidate.full_candidate, {
    correctedTopicDialogue: true
  });
  const roleResults = contracts.map((contract) => {
    const result = checkCustomStructuredOutputCompatibility({
      schema: contract.schema,
      schema_name: contract.schema_name
    });
    return {
      role: contract.role,
      schema_name: contract.schema_name,
      output_schema_version: contract.manifest_declared_schema_version,
      provider_payload_schema_version: contract.provider_payload_schema_version,
      compatible: result.compatible,
      schema_compiled: result.schema_compiled,
      issues: result.issues,
      production_source: contract.production_source,
      role_config_hash: candidate.role_config_hashes[contract.role]
    };
  });
  return {
    audit_version: "e2a6-v5-all-role-schema-audit-v1",
    candidate_hash: candidate.candidate_configuration_hash,
    role_count: roleResults.length,
    all_candidate_role_schemas_compile: roleResults.every((entry) => entry.compatible),
    blocking_roles: roleResults.filter((entry) => !entry.compatible).map((entry) => entry.role),
    role_results: roleResults,
    network_request_count: 0
  };
}

export async function compileE2A6CandidateRequestsNoNetwork(
  outputPath = path.join(E2A6_REQUEST_COMPILATION_ROOT, "all-role-request-compilation.json")
) {
  const candidate = evaluateE2A5Candidate();
  const contracts = productionRoleOutputContracts(candidate.full_candidate, {
    correctedTopicDialogue: true
  });
  const topicInput = e2a6DispatchCanaryCases()[0]?.input;
  if (!topicInput) throw new Error("e2a6_topic_dialogue_compilation_input_missing");
  const credential = resolveOpenAICredentialFromEnv({
    ...process.env,
    OPENAI_API_KEY: "sk-e2a6-no-network-credential-000000000000",
    OPENAI_API_KEY_FILE: undefined
  });
  if (!credential.ok) throw new Error(`e2a6_test_credential_invalid:${credential.code}`);

  const originalAbortHook = process.env.OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY;
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
          const results = [];
          for (const contract of contracts) {
            const requestInput = contract.role === "topic_dialogue_agent"
              ? topicInput
              : { synthetic_no_live_compilation: true };
            const result = await provider.executeStructured({
              agent_name: contract.role,
              model_config: candidate.full_candidate.roles[contract.role],
              instructions: contract.role === "topic_dialogue_agent"
                ? E2A5_TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS
                : "Compile this production output contract without dispatching a network request.",
              input: requestInput,
              output_schema: contract.schema,
              schema_name: contract.schema_name,
              client_request_id: `e2a6_compile_${contract.role}`,
              timeout_ms: candidate.full_candidate.runtime_policy.provider_timeout_ms,
              metadata: {
                purpose: "e2a6_no_live_request_compilation",
                audit_role: contract.role,
                candidate_hash_prefix: candidate.candidate_configuration_hash.slice(0, 12)
              }
            });
            results.push({
              role: contract.role,
              role_config_hash: candidate.role_config_hashes[contract.role],
              schema_name: contract.schema_name,
              output_schema_version: contract.manifest_declared_schema_version,
              request_status: result.status,
              transport_adapter_entered:
                result.transport_telemetry?.transport_adapter_entered ?? false,
              request_serialization_completed:
                result.transport_telemetry?.request_serialization_completed ?? false,
              fetch_invoked: result.transport_telemetry?.fetch_invoked ?? false,
              dispatch_boundary_reached:
                result.transport_telemetry?.request_serialization_completed === true &&
                result.transport_telemetry?.fetch_invoked === false,
              selected_input_schema_version: contract.role === "topic_dialogue_agent"
                ? topicInput.dialogue_schema_version
                : null,
              legacy_fallback_selected: false,
              sanitized_terminal_reason:
                result.transport_telemetry?.normalized_error?.error_name ??
                result.error?.category ??
                "test_transport_boundary"
            });
          }
          return results;
        }
      )
    );
    const fetchEvents = transportEvents.filter((event) => event.event_type === "fetch_invoked");
    const artifact = {
      compilation_version: E2A6_REQUEST_COMPILATION_VERSION,
      generated_at: new Date().toISOString(),
      selected_candidate_hash: candidate.candidate_configuration_hash,
      selected_input_schema_version: "topic-dialogue-input-v4",
      selected_output_schema_version: "topic-dialogue-output-v3",
      selected_validator_version: "eval-topic-boundary-v4",
      role_count: rows.length,
      all_requests_ready_for_dispatch: rows.length === 17 &&
        rows.every((entry) => entry.dispatch_boundary_reached),
      provider_generation_call_count: fetchEvents.length,
      network_request_count: fetchEvents.length,
      legacy_fallback_selected: rows.some((entry) => entry.legacy_fallback_selected),
      role_results: rows
    };
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    return { outputPath, artifact };
  } finally {
    if (originalAbortHook === undefined) {
      delete process.env.OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY;
    } else {
      process.env.OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY = originalAbortHook;
    }
    if (originalApprovedHash === undefined) {
      delete process.env.OPERATIONAL_APPROVED_CONFIG_HASH;
    } else {
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH = originalApprovedHash;
    }
  }
}
