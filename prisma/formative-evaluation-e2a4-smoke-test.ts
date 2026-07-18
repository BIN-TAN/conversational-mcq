import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkCustomStructuredOutputCompatibility } from "@/lib/agents/provider-schema-compat";
import {
  buildE2A4AllRoleSchemaAudit,
  compileE2A4CandidateRequestsNoNetwork
} from "@/lib/evaluation/formative/e2a4-structured-output-audit";
import {
  E2A4_CANDIDATE_FILE_SHA256,
  E2A4_CANDIDATE_HASH,
  E2A4_FAILED_E2A3_ARTIFACT_SHA256,
  E2A4_FAILED_E2A3_RUN_ID,
  E2A4_SOURCE_PROTOCOL_HASH,
  e2a4ProtectedArtifactSnapshot
} from "@/lib/evaluation/formative/e2a4-topic-dialogue-evaluation";
import {
  E2A4_FAILED_CANDIDATE_PATH,
  E2A4_FAILED_V3_FILE_SHA256,
  evaluateE2A4TopicDialogueCandidate,
  sha256
} from "@/lib/evaluation/formative/e2a4-topic-dialogue-contract";
import {
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
  TopicDialogueOutputV1Schema
} from "@/lib/services/student-assessment/topic-dialogue-agent";
import {
  TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION_V3,
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3,
  TopicDialogueOutputV3Schema,
  serializeTopicDialogueV3ForStudent,
  topicDialogueOutputV3ToRuntimeV2,
  topicDialogueV3AuditProjection,
  validateTopicDialogueOutputV3,
  type TopicDialogueOutputV3
} from "@/lib/services/student-assessment/topic-dialogue-output-v3";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const validOutput: TopicDialogueOutputV3 = {
  dialogue_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
  schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3,
  tutor_message: "Compare the reliability claim with the validity boundary. What exact assumption makes option A inaccurate?",
  student_message_function: "substantive_answer",
  response_function: "misconception_contrast",
  evidence_update: "The student response is being checked against the reliability and validity distinction.",
  remaining_issue: "The response must distinguish score consistency from support for an intended interpretation.",
  post_turn_understanding: "partial",
  evidence_sufficiency: "needs_more_evidence",
  topic_relation: "current_assessment_content",
  topic_boundary: "inside_scope",
  system_question_answered: false,
  next_action: "await_topic_dialogue_response",
  next_runtime_state: "AWAIT_TOPIC_DIALOGUE_RESPONSE",
  progression_readiness: "not_ready",
  requires_student_response: true,
  expected_response_guidance: "State the unsupported assumption in one sentence.",
  safety_flags: [],
  student_safe_summary: "The response remains focused on the current reliability and validity distinction."
};

async function main() {
const candidate = evaluateE2A4TopicDialogueCandidate();
assert(candidate.candidate_configuration_hash === E2A4_CANDIDATE_HASH, "candidate_hash_is_reproducible");
assert(candidate.candidate_file_sha256 === E2A4_CANDIDATE_FILE_SHA256, "candidate_file_sha_is_reproducible");
assert(candidate.compatible, "candidate_contract_must_be_compatible");
assert(candidate.exact_delta_paths_from_baseline.length === 4, "candidate_delta_path_count_invalid");

const oldCompatibility = checkCustomStructuredOutputCompatibility({
  schema: TopicDialogueOutputV1Schema,
  schema_name: "topic_dialogue_output_v2"
});
assert(!oldCompatibility.compatible, "structured_output_rejects_optional_non_nullable_property");
assert(
  oldCompatibility.issues.some((issue) => issue.message.includes("schema_version")),
  "old_schema_failure_must_identify_schema_version"
);

const newCompatibility = checkCustomStructuredOutputCompatibility({
  schema: TopicDialogueOutputV3Schema,
  schema_name: "topic_dialogue_output_v3"
});
assert(newCompatibility.compatible, "topic_dialogue_output_v3_compiles_for_provider");
const compiled = newCompatibility.json_schema as {
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: unknown;
};
assert(compiled.properties?.schema_version !== undefined, "compiled_schema_version_missing");
assert(compiled.required?.includes("schema_version"), "schema_version_is_required_literal");
assert(compiled.additionalProperties === false, "compiled_schema_must_reject_unknown_properties");

assert(validateTopicDialogueOutputV3(validOutput).valid, "valid_v3_output_rejected");
const withoutSchemaVersion = { ...validOutput } as Partial<TopicDialogueOutputV3>;
delete withoutSchemaVersion.schema_version;
assert(!validateTopicDialogueOutputV3(withoutSchemaVersion).valid, "missing_schema_version_is_rejected");
assert(!validateTopicDialogueOutputV3({
  ...validOutput,
  schema_version: "topic-dialogue-output-v2"
}).valid, "wrong_schema_version_is_rejected");
assert(!validateTopicDialogueOutputV3({
  ...validOutput,
  schema_version: null
}).valid, "null_schema_version_is_rejected");
assert(!validateTopicDialogueOutputV3({
  ...validOutput,
  unknown_output_property: true
}).valid, "unknown_output_property_is_rejected");
const withoutSemanticField = { ...validOutput } as Partial<TopicDialogueOutputV3>;
delete withoutSemanticField.remaining_issue;
assert(!validateTopicDialogueOutputV3(withoutSemanticField).valid, "missing_required_semantic_field_is_rejected");

const runtimeOutput = topicDialogueOutputV3ToRuntimeV2(validOutput);
assert(TopicDialogueOutputV1Schema.safeParse(runtimeOutput).success, "downstream_persistence_shape_rejected");
assert(runtimeOutput.schema_version === TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2, "runtime_adapter_version_invalid");
const studentProjection = serializeTopicDialogueV3ForStudent(validOutput);
assert(!("schema_version" in studentProjection), "student_projection_omits_schema_version");
assert(!JSON.stringify(studentProjection).includes(TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION_V3), "student_projection_leaks_validator");
const auditProjection = topicDialogueV3AuditProjection(validOutput);
assert(auditProjection.output_schema_version === TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3, "audit_projection_preserves_schema_provenance");
assert(auditProjection.validator_version === TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION_V3, "audit_projection_preserves_validator_provenance");
assert(TopicDialogueOutputV1Schema.safeParse(runtimeOutput).success, "old_v2_output_records_remain_readable");

const schemaAudit = buildE2A4AllRoleSchemaAudit();
assert(schemaAudit.role_count === 17, "all_role_audit_must_cover_17_roles");
assert(schemaAudit.all_candidate_role_schemas_compile, "all_candidate_role_schemas_compile");
assert(schemaAudit.network_request_count === 0, "no_network_call_during_schema_audit");
assert(schemaAudit.approved_runtime_latent_incompatibilities.length === 1, "approved_v2_latent_issue_missing");
assert(schemaAudit.candidate_blocking_incompatibilities.length === 0, "unexpected_candidate_blocking_schema");

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "e2a4-contract-smoke-"));
try {
  const compilation = await compileE2A4CandidateRequestsNoNetwork(
    path.join(tempRoot, "request-compilation.json")
  );
  assert(compilation.artifact.role_count === 17, "request_compilation_role_count_invalid");
  assert(compilation.artifact.all_requests_ready_for_dispatch, "provider_request_builder_reaches_dispatch_boundary");
  assert(compilation.artifact.network_request_count === 0, "no_network_call_during_request_compilation");
  assert(compilation.artifact.provider_generation_call_count === 0, "request_compilation_generation_call_detected");
  assert(!compilation.artifact.legacy_fallback_selected, "request_compilation_selected_legacy_fallback");
  assert(compilation.artifact.selected_candidate_hash === E2A4_CANDIDATE_HASH, "request_compilation_candidate_hash_mismatch");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

assert(
  sha256(readFileSync(E2A4_FAILED_CANDIDATE_PATH)) === E2A4_FAILED_V3_FILE_SHA256,
  "failed_v3_candidate_is_unchanged"
);
const protectedSnapshot = e2a4ProtectedArtifactSnapshot();
const failedRun = protectedSnapshot.tracked_groups.failed_e2a3_evaluation;
assert(failedRun.sha256 === E2A4_FAILED_E2A3_ARTIFACT_SHA256, "failed_e2a3_artifacts_are_unchanged");
const failedSummaryPath = path.join(
  process.cwd(),
  ".data",
  "e2a3-topic-dialogue-candidate-evaluation",
  E2A4_FAILED_E2A3_RUN_ID,
  "evaluation-summary.json"
);
const failedSummary = JSON.parse(readFileSync(failedSummaryPath, "utf8")) as { final_evaluation_status?: string };
assert(failedSummary.final_evaluation_status === "candidate_evaluation_failed", "failed_v3_evaluation_status_changed");
assert(E2A4_SOURCE_PROTOCOL_HASH.length === 64, "source_protocol_hash_invalid");

console.log(JSON.stringify({
  status: "passed",
  candidate_hash: E2A4_CANDIDATE_HASH,
  candidate_file_sha256: E2A4_CANDIDATE_FILE_SHA256,
  role_count: schemaAudit.role_count,
  all_candidate_role_schemas_compile: schemaAudit.all_candidate_role_schemas_compile,
  approved_runtime_latent_incompatibility_count:
    schemaAudit.approved_runtime_latent_incompatibilities.length,
  request_compilation_network_count: 0,
  failed_v3_candidate_unchanged: true,
  failed_e2a3_artifacts_unchanged: true,
  candidate_approved: false,
  candidate_activated: false
}, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a4_contract_smoke_failed");
  process.exitCode = 1;
});
