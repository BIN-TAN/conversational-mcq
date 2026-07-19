import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  E2A4_APPROVED_V2_HASH
} from "@/lib/evaluation/formative/e2a4-topic-dialogue-contract";
import {
  E2A5_FAILED_V4_HASH
} from "@/lib/evaluation/formative/e2a5-topic-dialogue-progression-contract";
import {
  E2A6_CANDIDATE_HASH
} from "@/lib/evaluation/formative/e2a6-v5-topic-dialogue-evaluation";
import {
  buildE2A7ModeSchemaAudit,
  compileE2A7CandidateRequestsNoNetwork
} from "@/lib/evaluation/formative/e2a7-request-compilation";
import {
  E2A7_CANDIDATE_FILE_SHA256,
  E2A7_CANDIDATE_HASH,
  buildTopicDialogueModeProviderInput,
  evaluateE2A7Candidate
} from "@/lib/evaluation/formative/e2a7-topic-dialogue-mode-candidate";
import {
  buildE2A7ForensicAccounting,
  e2a7ProtectedArtifactSnapshot,
  executeE2A7Adjudication
} from "@/lib/evaluation/formative/e2a7-v5-forensic-adjudication";
import {
  e2a6DispatchCanaryCases
} from "@/lib/evaluation/formative/e2a6-v5-topic-dialogue-protocol";
import {
  applyTopicDialogueModeResult,
  buildTopicDialogueModeFallback,
  buildTopicDialogueModeRequestEnvelope,
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS,
  TOPIC_DIALOGUE_MODE_PROMPTS,
  validateTopicDialogueModeOutput,
  type TopicDialogueResponseMode
} from "@/lib/services/student-assessment/topic-dialogue-response-mode";

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("e2a7_no_provider_call_allowed");
};

const modes: TopicDialogueResponseMode[] = [
  "remain_in_dialogue",
  "request_revision",
  "present_transfer",
  "complete_episode"
];

function schemaShape(mode: TopicDialogueResponseMode) {
  return TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS[mode]._def.shape();
}

function validOutput(mode: TopicDialogueResponseMode) {
  const shared = {
    tutor_message: mode === "remain_in_dialogue"
      ? "Reliability concerns score consistency, while validity needs evidence for an intended interpretation. What evidence is still missing from Item 2 option A?"
      : mode === "request_revision"
        ? "Revise Item 2 option A so it separates score consistency from validity evidence."
        : mode === "present_transfer"
          ? "Now apply the same distinction in a new context. The platform will present the transfer item."
          : "You supplied the accepted evidence for this bounded dialogue. This dialogue is complete.",
    evidence_update: "Synthetic no-live evidence update.",
    remaining_issue: mode === "remain_in_dialogue" || mode === "request_revision"
      ? "The reliability-validity boundary remains the focus."
      : null,
    student_safe_summary: mode === "complete_episode"
      ? "This dialogue is complete."
      : "Continue with the reliability-validity distinction.",
    expected_response_guidance: mode === "remain_in_dialogue" ||
      mode === "request_revision"
      ? "Provide the requested bounded explanation."
      : null,
    safety_flags: [],
    requires_student_response: mode === "remain_in_dialogue" ||
      mode === "request_revision"
  };
  if (mode === "remain_in_dialogue") return {
    schema_version: "topic-dialogue-remain-output-v1",
    response_function: "ask_narrowed_question",
    ...shared
  };
  if (mode === "request_revision") return {
    schema_version: "topic-dialogue-revision-output-v1",
    response_function: "revision_transition",
    ...shared
  };
  if (mode === "present_transfer") return {
    schema_version: "topic-dialogue-transfer-output-v1",
    response_function: "transfer_transition",
    ...shared
  };
  return {
    schema_version: "topic-dialogue-completion-output-v1",
    response_function: "completion_transition",
    ...shared
  };
}

async function main() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "e2a7-smoke-"));
  try {
    const protectedBefore = e2a7ProtectedArtifactSnapshot();
    const candidate = evaluateE2A7Candidate();
    assert.equal(candidate.approved_v2_hash, E2A4_APPROVED_V2_HASH);
    assert.equal(candidate.failed_v4_hash, E2A5_FAILED_V4_HASH);
    assert.equal(candidate.failed_v5_hash, E2A6_CANDIDATE_HASH);
    assert.equal(candidate.candidate_configuration_hash, E2A7_CANDIDATE_HASH);
    assert.equal(candidate.candidate_file_sha256, E2A7_CANDIDATE_FILE_SHA256);
    assert.equal(candidate.candidate_approved, false);
    assert.equal(candidate.candidate_activated, false);
    assert.equal(Object.keys(candidate.inherited_role_hashes).length, 16);

    const cases = e2a6DispatchCanaryCases();
    for (const mode of modes) {
      const testCase = cases.find((entry) =>
        entry.expected_authorized_action === mode
      );
      assert(testCase);
      const providerInput = buildTopicDialogueModeProviderInput({
        dialogue_input: testCase.input
      });
      assert.equal(providerInput.selected_response_mode, mode);
      assert.equal("progression_authorization" in providerInput, false);
      assert.throws(() => buildTopicDialogueModeProviderInput({
        dialogue_input: testCase.input,
        selected_mode: mode === "remain_in_dialogue"
          ? "request_revision"
          : "remain_in_dialogue"
      }), /selected_mode_must_equal_platform_authorization/u);
      const envelope = buildTopicDialogueModeRequestEnvelope({
        authorization: testCase.input.progression_authorization,
        provider_input: providerInput
      });
      assert.equal(envelope.selected_response_mode, mode);
      assert.equal(envelope.authorized_action, mode);
      assert.equal(envelope.output_schema, TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS[mode]);
      const output = validOutput(mode);
      const validation = validateTopicDialogueModeOutput({
        selected_mode: mode,
        output,
        latest_student_message: testCase.input.latest_student_message,
        latest_response_classification:
          testCase.input.latest_student_message_classification ??
            "server_classification_unavailable",
        distractor_anchor: "Item 2 option A",
        misconception_target: testCase.input.remaining_issue,
        strategies_already_attempted: [],
        platform_evidence_summary: "Synthetic no-live evidence."
      });
      assert.equal(validation.valid, true, JSON.stringify(validation.issues));
      const invalidValidation = validateTopicDialogueModeOutput({
        selected_mode: mode,
        output: { ...output, recommended_action: "complete_episode" },
        latest_student_message: testCase.input.latest_student_message,
        latest_response_classification:
          testCase.input.latest_student_message_classification ??
            "server_classification_unavailable",
        distractor_anchor: "Item 2 option A",
        misconception_target: testCase.input.remaining_issue,
        strategies_already_attempted: [],
        platform_evidence_summary: "Synthetic no-live evidence."
      });
      assert.equal(invalidValidation.valid, false);
      assert(invalidValidation.issues.some((issue) =>
        issue.rule_code === "provider_action_field_forbidden"
      ));
      const applied = applyTopicDialogueModeResult({
        envelope,
        validation: invalidValidation,
        fallback_input: {
          distractor_anchor: "Item 2 option A",
          misconception_target: testCase.input.remaining_issue,
          platform_evidence_summary: "Synthetic no-live evidence."
        }
      });
      assert.equal(applied.safe_fallback_used, true);
      assert.equal(applied.selected_response_mode, mode);
      assert.equal(applied.authorized_action, mode);
      assert.equal(applied.platform_action_preserved, true);
      assert.equal(
        buildTopicDialogueModeFallback({
          selected_mode: mode,
          distractor_anchor: "Item 2 option A",
          misconception_target: testCase.input.remaining_issue,
          platform_evidence_summary: "Synthetic no-live evidence."
        }).schema_version,
        output.schema_version
      );
    }

    const actionFields = [
      "next_action",
      "recommended_action",
      "next_runtime_state",
      "progression_readiness",
      "ready_to_advance",
      "sufficient_to_advance"
    ];
    for (const mode of modes) {
      const shape = schemaShape(mode);
      assert(actionFields.every((field) => !(field in shape)));
    }
    assert.deepEqual(
      TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS.request_revision.shape.response_function._def.value,
      "revision_transition"
    );
    assert.deepEqual(
      TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS.present_transfer.shape.response_function._def.value,
      "transfer_transition"
    );
    assert.deepEqual(
      TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS.complete_episode.shape.response_function._def.value,
      "completion_transition"
    );
    assert.match(TOPIC_DIALOGUE_MODE_PROMPTS.remain_in_dialogue,
      /Progression is not authorized/u);
    assert.match(TOPIC_DIALOGUE_MODE_PROMPTS.request_revision,
      /Do not mention transfer or completion/u);
    assert.match(TOPIC_DIALOGUE_MODE_PROMPTS.present_transfer,
      /Do not present the transfer item itself/u);
    assert.match(TOPIC_DIALOGUE_MODE_PROMPTS.complete_episode,
      /Do not introduce revision, transfer, another question/u);

    const accounting = buildE2A7ForensicAccounting();
    assert.equal(accounting.caseRows.length, 5);
    assert.equal(accounting.outputRows.length, 10);
    assert.equal(accounting.aggregate.candidate_validation_failure_count, 7);
    assert.equal(accounting.aggregate.regeneration_attempted_case_count, 5);
    assert.equal(accounting.aggregate.regeneration_succeeded_case_count, 3);
    assert.equal(accounting.aggregate.platform_gate_authorized_case_count, 4);
    assert.equal(accounting.aggregate.platform_override_applied_case_count, 1);
    assert.equal(accounting.aggregate.safe_fallback_used_case_count, 2);
    assert.equal(accounting.aggregate.executed_transition_case_count, 0);
    assert.equal(accounting.aggregate.automated_case_pass_count, 1);
    assert.equal(accounting.aggregate.v6_replay_compatible_output_count, 3);
    assert.equal(accounting.aggregate.v6_replay_compatible_case_count, 3);
    const revision = accounting.caseRows.find((entry) =>
      entry.case_id === "e2a6_canary_revision_authorized"
    );
    assert(revision);
    assert.equal(revision.candidate_semantic_valid, false);
    assert.equal(revision.platform_gate_authorized, false);
    assert.equal(revision.platform_override_applied, true);
    assert.equal(revision.safe_fallback_used, true);
    assert.equal(revision.executed_transition, false);
    assert(accounting.outputRows.some((entry) =>
      entry.case_id === "e2a6_canary_remain_repeated_confusion" &&
      entry.adjudication_classification.includes(
        "unauthorized_progression_language"
      ) && !entry.v6_historical_replay_accepted
    ));
    assert(accounting.outputRows.every((entry) =>
      entry.no_provider_dispatch_during_replay
    ));

    const schemaAudit = buildE2A7ModeSchemaAudit();
    assert.equal(schemaAudit.mode_count, 4);
    assert.equal(schemaAudit.all_mode_schemas_compile, true);
    assert.equal(schemaAudit.all_provider_action_fields_absent, true);
    const compilation = await compileE2A7CandidateRequestsNoNetwork(
      path.join(tempRoot, "standalone-request-compilation.json")
    );
    assert.equal(compilation.artifact.role_count, 17);
    assert.equal(compilation.artifact.request_count, 20);
    assert.equal(compilation.artifact.topic_dialogue_mode_request_count, 4);
    assert.equal(compilation.artifact.all_17_roles_compile, true);
    assert.equal(compilation.artifact.network_request_count, 0);

    const run = await executeE2A7Adjudication({
      artifactRoot: tempRoot,
      runId: "e2a7_smoke"
    });
    assert.equal(run.manifest.case_count, 5);
    assert.equal(run.manifest.provider_output_replay_count, 10);
    assert.equal(run.manifest.provider_generation_call_count, 0);
    assert.equal(run.manifest.candidate_approved, false);
    assert.equal(run.manifest.candidate_activated, false);
    assert.equal(Object.values(run.paths).every((file) =>
      readFileSync(file, "utf8").length > 0
    ), true);
    const protectedAfter = e2a7ProtectedArtifactSnapshot();
    assert.equal(protectedAfter.aggregate_sha256, protectedBefore.aggregate_sha256);
    assert.equal(networkCalls, 0);
    console.log(JSON.stringify({
      status: "passed",
      focused_requirement_count: 25,
      case_accounting_count: accounting.caseRows.length,
      output_replay_count: accounting.outputRows.length,
      v6_replay_compatible_output_count:
        accounting.aggregate.v6_replay_compatible_output_count,
      mode_schema_count: schemaAudit.mode_count,
      compiled_role_count: compilation.artifact.role_count,
      compiled_request_count: compilation.artifact.request_count,
      candidate_hash: candidate.candidate_configuration_hash,
      protected_artifacts_unchanged: true,
      provider_call_count: networkCalls
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
