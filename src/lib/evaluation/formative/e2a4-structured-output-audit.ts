import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { agentOutputSchemas } from "@/lib/agents/contracts";
import { checkCustomStructuredOutputCompatibility } from "@/lib/agents/provider-schema-compat";
import { LiveModelRole, type LiveModelRole as LiveModelRoleType } from "@/lib/llm/config";
import {
  resolveOpenAICredentialFromEnv,
  withResolvedOpenAICredential
} from "@/lib/llm/openai-credential-resolver";
import {
  OpenAIResponsesProvider,
  withOpenAIResponsesTransportBoundaryObserver
} from "@/lib/llm/providers/openai-responses-provider";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  McqDiagnosticAuthoringSuggestionSchema,
  McqFormattingSuggestionSchema
} from "@/lib/services/content/mcq-import";
import { ActivityMisconceptionEvidencePacketV1Schema } from "@/lib/services/student-assessment/activity-misconception-evidence";
import { FormativeActivityPacketV1Schema } from "@/lib/services/student-assessment/formative-activity-design";
import { FormativeActivityQualityReviewV1Schema } from "@/lib/services/student-assessment/formative-activity-live";
import { FormativeValueDeterminationPacketV1Schema } from "@/lib/services/student-assessment/formative-value-determination";
import { ItemAdministrationTutorOutputSchema } from "@/lib/services/student-assessment/item-administration-tutor";
import { ProfileIntegrationInterpretationPacketV1Schema } from "@/lib/services/student-assessment/profile-integration";
import { StudentCommunicationOutputV1Schema } from "@/lib/services/student-assessment/student-communication-agent";
import {
  TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
  TopicDialogueOutputV1Schema
} from "@/lib/services/student-assessment/topic-dialogue-agent";
import { TopicDialogueOutputV3Schema } from "@/lib/services/student-assessment/topic-dialogue-output-v3";
import {
  E2A4_APPROVED_V2_HASH,
  evaluateE2A4TopicDialogueCandidate,
  type E2A4BaselineManifest
} from "./e2a4-topic-dialogue-contract";

export const E2A4_STRUCTURED_OUTPUT_AUDIT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a4-structured-output-audit"
);
export const E2A4_SCHEMA_AUDIT_VERSION = "e2a4-all-role-schema-audit-v1";
export const E2A4_REQUEST_COMPILATION_VERSION =
  "e2a4-production-request-compilation-v1";

export type ProductionRoleOutputContract = {
  role: LiveModelRoleType;
  schema: z.ZodType<unknown>;
  schema_name: string;
  manifest_declared_schema_version: string;
  provider_payload_schema_version: string;
  production_source: string;
  schema_alias_note: string | null;
};

function metadataSchemaVersion(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.output_schema_version ?? metadata?.schema_version;
  return typeof value === "string" ? value : "schema-version-unavailable";
}

export function productionRoleOutputContracts(
  manifest: E2A4BaselineManifest,
  options: { correctedTopicDialogue: boolean }
): ProductionRoleOutputContract[] {
  const metadata = manifest.configuration_fingerprint.role_version_metadata;
  const contract = (
    role: LiveModelRoleType,
    schema: z.ZodType<unknown>,
    productionSource: string,
    payloadSchemaVersion?: string,
    schemaAliasNote: string | null = null
  ): ProductionRoleOutputContract => {
    const declared = metadataSchemaVersion(metadata[role]);
    return {
      role,
      schema,
      schema_name: role === "topic_dialogue_agent" && options.correctedTopicDialogue
        ? "topic_dialogue_output_v3"
        : declared.replace(/[^a-zA-Z0-9_-]/gu, "_"),
      manifest_declared_schema_version: declared,
      provider_payload_schema_version: payloadSchemaVersion ?? declared,
      production_source: productionSource,
      schema_alias_note: schemaAliasNote
    };
  };

  const contracts: ProductionRoleOutputContract[] = [
    contract("item_verification_agent", agentOutputSchemas.item_verification_agent, "src/lib/agents/contracts.ts"),
    contract("item_administration_tutor_agent", ItemAdministrationTutorOutputSchema, "src/lib/services/student-assessment/item-administration-tutor.ts"),
    contract("response_collection_agent", agentOutputSchemas.response_collection_agent, "src/lib/agents/contracts.ts"),
    contract("student_profiling_agent", agentOutputSchemas.student_profiling_agent, "src/lib/agents/contracts.ts"),
    contract("profile_integration_agent", ProfileIntegrationInterpretationPacketV1Schema, "src/lib/services/student-assessment/profile-integration.ts"),
    contract("formative_value_and_planning_agent", agentOutputSchemas.formative_value_and_planning_agent, "src/lib/agents/contracts.ts"),
    contract("formative_value_determination_agent", FormativeValueDeterminationPacketV1Schema, "src/lib/services/student-assessment/formative-value-determination.ts"),
    contract("followup_agent", agentOutputSchemas.followup_agent, "src/lib/agents/contracts.ts"),
    contract("formative_activity_dialogue_agent", FormativeActivityPacketV1Schema, "src/lib/services/student-assessment/formative-activity-live.ts"),
    contract("formative_activity_quality_reviewer_agent", FormativeActivityQualityReviewV1Schema, "src/lib/services/student-assessment/formative-activity-live.ts"),
    contract(
      "formative_activity_response_evaluator_agent",
      ActivityMisconceptionEvidencePacketV1Schema,
      "src/lib/services/student-assessment/activity-misconception-evidence-live.ts",
      "student-activity-misconception-evidence-v1",
      "The production request schema_name is formative-activity-response-evaluation-v1; its payload schema_version literal is student-activity-misconception-evidence-v1."
    ),
    contract(
      "post_activity_evidence_evaluator_agent",
      ActivityMisconceptionEvidencePacketV1Schema,
      "src/lib/services/student-assessment/activity-misconception-evidence-live.ts",
      "student-activity-misconception-evidence-v1"
    ),
    contract("student_communication_agent", StudentCommunicationOutputV1Schema, "src/lib/services/student-assessment/student-communication-agent.ts"),
    contract(
      "topic_dialogue_agent",
      options.correctedTopicDialogue ? TopicDialogueOutputV3Schema : TopicDialogueOutputV1Schema,
      options.correctedTopicDialogue
        ? "src/lib/services/student-assessment/topic-dialogue-output-v3.ts"
        : "src/lib/services/student-assessment/topic-dialogue-agent.ts",
      options.correctedTopicDialogue ? "topic-dialogue-output-v3" : "topic-dialogue-output-v2"
    ),
    contract("mcq_diagnostic_authoring_assistant_agent", McqDiagnosticAuthoringSuggestionSchema, "src/lib/services/content/mcq-import.ts"),
    contract("mcq_import_formatting_assistant_agent", McqFormattingSuggestionSchema, "src/lib/services/content/mcq-import.ts"),
    contract(
      "connectivity_test",
      agentOutputSchemas.response_collection_agent,
      "src/lib/llm/connectivity.ts -> src/lib/agents/execute-agent.ts",
      "response-collection-output-v3",
      "Connectivity is a utility invocation of response_collection_agent and therefore compiles the response-collection provider contract."
    )
  ];
  const expected = [...LiveModelRole.options].sort();
  const actual = contracts.map((entry) => entry.role).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("e2a4_role_output_contract_inventory_mismatch");
  }
  return contracts;
}

type ZodNode = z.ZodType<unknown> & {
  _def: Record<string, unknown> & {
    typeName?: string;
    innerType?: z.ZodType<unknown>;
    schema?: z.ZodType<unknown>;
    type?: z.ZodType<unknown>;
    out?: z.ZodType<unknown>;
    left?: z.ZodType<unknown>;
    right?: z.ZodType<unknown>;
    options?: z.ZodType<unknown>[];
    valueType?: z.ZodType<unknown>;
    items?: z.ZodType<unknown>[];
    shape?: (() => Record<string, z.ZodType<unknown>>) | Record<string, z.ZodType<unknown>>;
  };
};

function zodContractPaths(schema: z.ZodType<unknown>) {
  const optional = new Set<string>();
  const nullable = new Set<string>();
  const seen = new Set<z.ZodType<unknown>>();
  const walk = (node: z.ZodType<unknown>, pathValue: string) => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.isOptional()) optional.add(pathValue);
    if (node.isNullable()) nullable.add(pathValue);
    const typed = node as ZodNode;
    const typeName = String(typed._def.typeName ?? "");
    if (typeName === "ZodObject") {
      const rawShape = typed._def.shape;
      const shape = typeof rawShape === "function" ? rawShape() : rawShape ?? {};
      for (const [key, child] of Object.entries(shape)) {
        walk(child, `${pathValue}.${key}`);
      }
      return;
    }
    if (typeName === "ZodArray" && typed._def.type) {
      walk(typed._def.type, `${pathValue}[]`);
      return;
    }
    if (typeName === "ZodTuple") {
      (typed._def.items ?? []).forEach((child, index) => walk(child, `${pathValue}[${index}]`));
      return;
    }
    if (typeName === "ZodUnion" || typeName === "ZodDiscriminatedUnion") {
      const options = Array.isArray(typed._def.options)
        ? typed._def.options
        : [...((typed._def.options as unknown as Map<unknown, z.ZodType<unknown>>)?.values?.() ?? [])];
      options.forEach((child, index) => walk(child, `${pathValue}<union:${index}>`));
      return;
    }
    if (typeName === "ZodIntersection") {
      if (typed._def.left) walk(typed._def.left, `${pathValue}<left>`);
      if (typed._def.right) walk(typed._def.right, `${pathValue}<right>`);
      return;
    }
    if (typeName === "ZodRecord" && typed._def.valueType) {
      walk(typed._def.valueType, `${pathValue}{value}`);
      return;
    }
    const wrapped = typed._def.innerType ?? typed._def.schema ?? typed._def.out;
    if (wrapped) walk(wrapped, pathValue);
  };
  walk(schema, "output");
  return {
    optional_property_paths: [...optional].sort(),
    nullable_property_paths: [...nullable].sort()
  };
}

function jsonSchemaDetails(jsonSchema: unknown) {
  const missingRequired = new Set<string>();
  const additionalProperties = new Set<string>();
  const unsupportedKeywords = new Set<string>();
  let propertyCount = 0;
  let requiredCount = 0;
  const unsupported = new Set([
    "oneOf",
    "allOf",
    "not",
    "if",
    "then",
    "else",
    "dependentSchemas",
    "patternProperties",
    "unevaluatedProperties",
    "propertyNames"
  ]);
  const walk = (value: unknown, currentPath: string) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (unsupported.has(key)) unsupportedKeywords.add(`${currentPath}.${key}`);
    }
    const properties = record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
      ? record.properties as Record<string, unknown>
      : null;
    if (record.type === "object" || properties) {
      const names = Object.keys(properties ?? {});
      const required = Array.isArray(record.required)
        ? record.required.filter((entry): entry is string => typeof entry === "string")
        : [];
      propertyCount += names.length;
      requiredCount += required.length;
      for (const name of names) {
        if (!required.includes(name)) missingRequired.add(`${currentPath}.properties.${name}`);
      }
      additionalProperties.add(
        `${currentPath}:${record.additionalProperties === false ? "false" : String(record.additionalProperties)}`
      );
      for (const [name, child] of Object.entries(properties ?? {})) {
        walk(child, `${currentPath}.properties.${name}`);
      }
    }
    if (record.items) walk(record.items, `${currentPath}.items`);
    for (const key of ["anyOf", "oneOf", "allOf"] as const) {
      const entries = record[key];
      if (Array.isArray(entries)) entries.forEach((child, index) => walk(child, `${currentPath}.${key}[${index}]`));
    }
    for (const definitionsKey of ["$defs", "definitions"] as const) {
      const definitions = record[definitionsKey];
      if (definitions && typeof definitions === "object" && !Array.isArray(definitions)) {
        for (const [name, child] of Object.entries(definitions as Record<string, unknown>)) {
          walk(child, `${currentPath}.${definitionsKey}.${name}`);
        }
      }
    }
  };
  walk(jsonSchema, "#");
  const root = jsonSchema && typeof jsonSchema === "object" && !Array.isArray(jsonSchema)
    ? jsonSchema as Record<string, unknown>
    : {};
  return {
    root_object_valid: root.type === "object" && !root.anyOf && !root.oneOf && !root.allOf,
    required_property_coverage: {
      property_count: propertyCount,
      required_count: requiredCount,
      missing_required_paths: [...missingRequired].sort(),
      complete: missingRequired.size === 0
    },
    additional_properties_behavior: [...additionalProperties].sort(),
    top_level_any_of: Array.isArray(root.anyOf),
    unsupported_json_schema_keywords: [...unsupportedKeywords].sort()
  };
}

function auditContract(contract: ProductionRoleOutputContract) {
  const formatter = checkCustomStructuredOutputCompatibility({
    schema: contract.schema,
    schema_name: contract.schema_name
  });
  const zodPaths = zodContractPaths(contract.schema);
  const details = formatter.schema_compiled
    ? jsonSchemaDetails(formatter.json_schema)
    : {
        root_object_valid: false,
        required_property_coverage: {
          property_count: 0,
          required_count: 0,
          missing_required_paths: [],
          complete: false
        },
        additional_properties_behavior: [],
        top_level_any_of: false,
        unsupported_json_schema_keywords: []
      };
  return {
    role: contract.role,
    output_schema_version: contract.manifest_declared_schema_version,
    provider_payload_schema_version: contract.provider_payload_schema_version,
    production_source: contract.production_source,
    schema_alias_note: contract.schema_alias_note,
    ...details,
    ...zodPaths,
    request_formatter_result: formatter.compatible ? "accepted" : "rejected",
    formatter_issues: formatter.issues,
    dispatch_allowed: formatter.compatible,
    incompatibility_classification: formatter.compatible ? "not_applicable" : "candidate-blocking",
    compiled_json_schema_sha256: formatter.json_schema
      ? stableHash(formatter.json_schema)
      : null
  };
}

export function buildE2A4AllRoleSchemaAudit() {
  const candidate = evaluateE2A4TopicDialogueCandidate();
  const candidateContracts = productionRoleOutputContracts(candidate.full_candidate, {
    correctedTopicDialogue: true
  });
  const roleResults = candidateContracts.map(auditContract);
  const approvedTopicContract = productionRoleOutputContracts(candidate.full_candidate, {
    correctedTopicDialogue: false
  }).find((entry) => entry.role === "topic_dialogue_agent");
  if (!approvedTopicContract) throw new Error("e2a4_approved_topic_contract_missing");
  const approvedTopicComparison = auditContract(approvedTopicContract);
  const blocking = roleResults.filter((entry) => !entry.dispatch_allowed);
  return {
    audit_version: E2A4_SCHEMA_AUDIT_VERSION,
    generated_at: new Date().toISOString(),
    network_request_count: 0,
    candidate_hash: candidate.candidate_configuration_hash,
    role_count: roleResults.length,
    all_candidate_role_schemas_compile: blocking.length === 0,
    candidate_blocking_incompatibilities: blocking.map((entry) => entry.role),
    approved_runtime_latent_incompatibilities: approvedTopicComparison.dispatch_allowed
      ? []
      : [{
          ...approvedTopicComparison,
          incompatibility_classification: "approved-runtime latent incompatibility"
        }],
    role_results: roleResults
  };
}

export function writeE2A4AllRoleSchemaAudit(
  outputPath = path.join(E2A4_STRUCTURED_OUTPUT_AUDIT_ROOT, "schema-compatibility.json")
) {
  const audit = buildE2A4AllRoleSchemaAudit();
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  return { outputPath, audit };
}

export async function compileE2A4CandidateRequestsNoNetwork(
  outputPath = path.join(E2A4_STRUCTURED_OUTPUT_AUDIT_ROOT, "request-compilation.json")
) {
  const candidate = evaluateE2A4TopicDialogueCandidate();
  const contracts = productionRoleOutputContracts(candidate.full_candidate, {
    correctedTopicDialogue: true
  });
  const credential = resolveOpenAICredentialFromEnv({
    ...process.env,
    OPENAI_API_KEY: "sk-e2a4-no-network-credential-000000000000",
    OPENAI_API_KEY_FILE: undefined
  });
  if (!credential.ok) throw new Error(`e2a4_test_credential_invalid:${credential.code}`);
  const originalAbortHook = process.env.OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY;
  const originalApprovedHash = process.env.OPERATIONAL_APPROVED_CONFIG_HASH;
  process.env.OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY = "true";
  process.env.OPERATIONAL_APPROVED_CONFIG_HASH = E2A4_APPROVED_V2_HASH;
  const transportEvents: Array<{ role: string; event_type: string }> = [];
  try {
    const results = await withResolvedOpenAICredential(
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
          const rows = [];
          for (const contract of contracts) {
            const result = await provider.executeStructured({
              agent_name: contract.role,
              model_config: candidate.full_candidate.roles[contract.role],
              instructions: contract.role === "topic_dialogue_agent"
                ? TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS
                : "Compile this production output contract without dispatching a network request.",
              input: { synthetic_no_live_compilation: true },
              output_schema: contract.schema,
              schema_name: contract.schema_name,
              client_request_id: `e2a4_compile_${contract.role}`,
              timeout_ms: candidate.full_candidate.runtime_policy.provider_timeout_ms,
              metadata: {
                purpose: "e2a4_no_live_request_compilation",
                audit_role: contract.role,
                candidate_hash_prefix: candidate.candidate_configuration_hash.slice(0, 12)
              }
            });
            rows.push({
              role: contract.role,
              schema_name: contract.schema_name,
              output_schema_version: contract.manifest_declared_schema_version,
              provider_payload_schema_version: contract.provider_payload_schema_version,
              request_status: result.status,
              transport_adapter_entered:
                result.transport_telemetry?.transport_adapter_entered ?? false,
              request_serialization_completed:
                result.transport_telemetry?.request_serialization_completed ?? false,
              fetch_invoked: result.transport_telemetry?.fetch_invoked ?? false,
              dispatch_boundary_reached:
                result.transport_telemetry?.request_serialization_completed === true &&
                result.transport_telemetry?.fetch_invoked === false,
              legacy_fallback_selected: false,
              sanitized_terminal_reason:
                result.transport_telemetry?.normalized_error?.error_name ??
                result.error?.category ??
                "test_transport_boundary"
            });
          }
          return rows;
        }
      )
    );
    const fetchEvents = transportEvents.filter((event) => event.event_type === "fetch_invoked");
    const artifact = {
      compilation_version: E2A4_REQUEST_COMPILATION_VERSION,
      generated_at: new Date().toISOString(),
      selected_candidate_hash: candidate.candidate_configuration_hash,
      selected_input_schema_version: "topic-dialogue-input-v3",
      selected_output_schema_version: "topic-dialogue-output-v3",
      role_count: results.length,
      all_requests_ready_for_dispatch: results.every((entry) => entry.dispatch_boundary_reached),
      provider_generation_call_count: fetchEvents.length,
      network_request_count: fetchEvents.length,
      approved_v2_schema_mutated: false,
      legacy_fallback_selected: results.some((entry) => entry.legacy_fallback_selected),
      role_results: results
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
