import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from "node:fs";
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
  E2A7_CANDIDATE_FILE_SHA256,
  E2A7_CANDIDATE_HASH
} from "@/lib/evaluation/formative/e2a7-topic-dialogue-mode-candidate";
import {
  E2A9_CANDIDATE_FILE_SHA256,
  E2A9_CANDIDATE_HASH,
  buildTopicDialogueOperationProviderInput,
  evaluateE2A9Candidate
} from "@/lib/evaluation/formative/e2a9-topic-dialogue-operation-candidate";
import {
  E2A9_ADJUDICATION_CLASSES,
  e2a9ProtectedArtifactSnapshot,
  executeE2A9Adjudication,
  loadE2A9Adjudication
} from "@/lib/evaluation/formative/e2a9-remain-dialogue-adjudication";
import {
  buildE2A9SchemaAudit,
  compileE2A9CandidateRequestsNoNetwork
} from "@/lib/evaluation/formative/e2a9-request-compilation";
import {
  e2a9HeldOutOperationCases
} from "@/lib/evaluation/formative/e2a9-topic-dialogue-operation-protocol";
import {
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMAS,
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS,
  TOPIC_DIALOGUE_OPERATION_POSITIVE_PURPOSES,
  TOPIC_DIALOGUE_OPERATION_PROMPT_TEMPLATES,
  TopicDialogueOperationSchema,
  buildTopicDialogueOperationFallback,
  buildTopicDialogueOperationRepairInstructions,
  buildTopicDialogueOperationRequestEnvelope,
  detectUnauthorizedProgressionLanguage,
  evaluateDirectResponseForOperation,
  evaluateSemanticAnchorContinuity,
  selectTopicDialogueOperation,
  validateTopicDialogueOperationOutput,
  type TopicDialogueOperation
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("e2a9_no_provider_call_allowed");
};

const expectedRouting = {
  unsupported_understanding_claim: "elicit_anchor_evidence",
  continued_conceptual_confusion: "clarify_concept_with_new_strategy",
  task_language_confusion: "clarify_task",
  protected_request: "protected_redirect",
  recurrence_after_apparent_improvement: "repair_recurrence",
  off_topic_response: "redirect_off_topic",
  partial_but_incomplete_reasoning: "refine_partial_reasoning"
} as const;

function validOutput(operation: TopicDialogueOperation, message: string) {
  return {
    schema_version: TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS[operation],
    student_facing_message: message
  };
}

function artifactFiles(runDirectory: string) {
  return readdirSync(runDirectory).sort();
}

async function main() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "e2a9-smoke-"));
  const originalApprovedHash = process.env.OPERATIONAL_APPROVED_CONFIG_HASH;
  try {
    const protectedBefore = e2a9ProtectedArtifactSnapshot();
    const candidate = evaluateE2A9Candidate();
    assert.equal(candidate.approved_v2_hash, E2A4_APPROVED_V2_HASH);
    assert.equal(candidate.failed_v4_hash, E2A5_FAILED_V4_HASH);
    assert.equal(candidate.failed_v5_hash, E2A6_CANDIDATE_HASH);
    assert.equal(candidate.failed_v6_hash, E2A7_CANDIDATE_HASH);
    assert.equal(candidate.failed_v6_file_sha256, E2A7_CANDIDATE_FILE_SHA256);
    assert.equal(candidate.candidate_configuration_hash, E2A9_CANDIDATE_HASH);
    assert.equal(candidate.candidate_file_sha256, E2A9_CANDIDATE_FILE_SHA256);
    assert.equal(candidate.candidate_approved, false);
    assert.equal(candidate.candidate_activated, false);
    assert.equal(Object.keys(candidate.inherited_role_hashes).length, 16);
    assert.equal(
      Object.keys(candidate.role_config_hashes).length,
      17
    );

    for (const [classification, operation] of Object.entries(expectedRouting)) {
      assert.equal(selectTopicDialogueOperation({
        selected_response_mode: "remain_in_dialogue",
        latest_response_classification:
          classification as keyof typeof expectedRouting
      }), operation);
    }
    assert.throws(() => selectTopicDialogueOperation({
      selected_response_mode: "request_revision",
      latest_response_classification: "unsupported_understanding_claim"
    }), /operation_requires_remain_in_dialogue/u);

    const heldOut = e2a9HeldOutOperationCases();
    assert.equal(heldOut.length, 7);
    assert.deepEqual(
      new Set(heldOut.map((entry) => entry.operation)),
      new Set(TopicDialogueOperationSchema.options)
    );
    for (const testCase of heldOut) {
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
      assert.equal(providerInput.selected_response_mode, "remain_in_dialogue");
      assert.equal(providerInput.selected_dialogue_operation, testCase.operation);
      assert.equal(
        providerInput.operation_context.historical_recommendations_authoritative,
        false
      );
      assert.equal(providerInput.operation_context.evaluation_only_fields_removed,
        true);
      assert.equal(
        providerInput.visible_dialogue_history.length,
        testCase.dialogue_input.visible_dialogue_history.length
      );
      for (const removed of [
        "available_progression_destinations",
        "progression_options",
        "post_activity_status",
        "source_versions",
        "source_profile_version",
        "source_activity_evaluation_version"
      ]) {
        assert.equal(removed in providerInput, false, removed);
      }
      assert.throws(() => buildTopicDialogueOperationProviderInput({
        dialogue_input: testCase.dialogue_input,
        selected_operation: testCase.operation === "clarify_task"
          ? "protected_redirect"
          : "clarify_task",
        routing_classification: testCase.routing_classification,
        distractor_anchor: testCase.distractor_anchor,
        misconception_target: testCase.misconception_target,
        evidence_needed: testCase.evidence_needed,
        strategies_already_attempted: testCase.strategies_already_attempted,
        strategies_marked_unsuccessful:
          testCase.strategies_marked_unsuccessful
      }), /must_equal_platform_selection/u);

      const prompt = TOPIC_DIALOGUE_OPERATION_PROMPT_TEMPLATES[testCase.operation];
      assert.match(prompt, /Positive communication purpose:/u);
      assert.match(prompt, /Never choose, replace, broaden, or narrow/u);
      assert.equal(prompt.includes(testCase.dialogue_input.latest_student_message),
        false);
      const envelope = buildTopicDialogueOperationRequestEnvelope({
        selected_response_mode: "remain_in_dialogue",
        selected_operation: testCase.operation,
        provider_input: providerInput,
        prompt_context: {
          latest_student_message: providerInput.latest_student_message,
          distractor_anchor: testCase.distractor_anchor,
          misconception_or_partial_understanding_target:
            testCase.misconception_target,
          evidence_needed: testCase.evidence_needed,
          strategies_already_attempted: testCase.strategies_already_attempted,
          strategies_marked_unsuccessful:
            testCase.strategies_marked_unsuccessful,
          visible_dialogue_history: providerInput.visible_dialogue_history
        }
      });
      assert.equal(envelope.selected_dialogue_operation, testCase.operation);
      assert.equal(envelope.provider_cannot_select_dialogue_operation, true);
      assert.match(envelope.instructions,
        /Authoritative current-turn directive:/u);
      assert.match(envelope.instructions,
        /Historical recommendations authoritative: false/u);
      assert.match(envelope.instructions,
        new RegExp(testCase.operation, "u"));
      assert.equal(
        envelope.output_schema,
        TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMAS[testCase.operation]
      );

      const validation = validateTopicDialogueOperationOutput({
        selected_response_mode: "remain_in_dialogue",
        selected_operation: testCase.operation,
        output: validOutput(testCase.operation, testCase.expected_valid_message),
        latest_student_message: testCase.dialogue_input.latest_student_message,
        distractor_anchor: testCase.distractor_anchor,
        misconception_target: testCase.misconception_target,
        evidence_needed: testCase.evidence_needed,
        strategies_already_attempted: testCase.strategies_already_attempted,
        prohibited_repeated_strategies:
          testCase.strategies_marked_unsuccessful
      });
      assert.equal(validation.valid, true, JSON.stringify(validation.findings));

      const providerControlAttempt = TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMAS[
        testCase.operation
      ].safeParse({
        ...validOutput(testCase.operation, testCase.expected_valid_message),
        dialogue_operation: testCase.operation
      });
      assert.equal(providerControlAttempt.success, false);

      const fallback = buildTopicDialogueOperationFallback({
        operation: testCase.operation,
        distractor_anchor: testCase.distractor_anchor
      });
      assert.equal(fallback.schema_version,
        TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS[testCase.operation]);
      assert.notEqual(fallback.student_facing_message.length, 0);
    }

    const progressionTruePositives = [
      "You are ready to revise.",
      "Let's move to the transfer task.",
      "You can continue to the next stage.",
      "The misconception has been resolved.",
      "This activity is complete.",
      "Choose the revision option now.",
      "You have shown enough to advance."
    ];
    for (const message of progressionTruePositives) {
      assert.notEqual(detectUnauthorizedProgressionLanguage({
        message,
        operation: "refine_partial_reasoning"
      }).length, 0, message);
    }
    const benignProgressionWords = [
      "When you are ready, explain why Option B still seems plausible.",
      "Continue by comparing the two ideas.",
      "Let's keep working through this example.",
      "Are you ready to try a smaller question?"
    ];
    for (const message of benignProgressionWords) {
      assert.equal(detectUnauthorizedProgressionLanguage({
        message,
        operation: "clarify_concept_with_new_strategy"
      }).length, 0, message);
    }

    assert.equal(evaluateDirectResponseForOperation({
      operation: "clarify_concept_with_new_strategy",
      latest_student_message: "What exact evidence is missing?",
      message:
        "The missing evidence must connect the scores to the intended interpretation; a reliability coefficient only supports consistency."
    }).passed, true);
    assert.equal(evaluateDirectResponseForOperation({
      operation: "clarify_concept_with_new_strategy",
      latest_student_message: "What exact evidence is missing?",
      message: "Let us return to your earlier confidence rating."
    }).passed, false);

    assert.equal(evaluateSemanticAnchorContinuity({
      message:
        "Item 2 option A treats consistent scores as sufficient evidence for the intended interpretation.",
      distractor_anchor: "Item 2 option A",
      misconception_target: "Consistency does not establish validity."
    }).continuity_level, "literal");
    assert.equal(evaluateSemanticAnchorContinuity({
      message:
        "A reliability coefficient supports consistency, while validity requires separate evidence for the intended interpretation.",
      distractor_anchor: "Item 2 option A",
      misconception_target: "Consistency does not establish validity."
    }).continuity_level, "conceptual");
    assert.equal(evaluateSemanticAnchorContinuity({
      message: "Try explaining your thinking in more detail.",
      distractor_anchor: "Item 2 option A",
      misconception_target: "Consistency does not establish validity."
    }).passed, false);

    const repair = buildTopicDialogueOperationRepairInstructions({
      operation: "repair_recurrence",
      original_instructions: "Original operation-specific instructions.",
      latest_student_message: "Would an almost perfect coefficient settle it?",
      distractor_anchor: "Item 2 option A",
      failed_requirements: [
        "strategy_not_genuinely_adapted",
        "unauthorized_progression_language"
      ],
      prohibited_repeated_strategies: ["direct_explanation"]
    });
    assert.match(repair, /remains exactly repair_recurrence/u);
    assert.match(repair, /Would an almost perfect coefficient settle it\?/u);
    assert.match(repair, /Item 2 option A/u);
    assert.match(repair, /strategy_not_genuinely_adapted/u);
    assert.match(repair, /direct_explanation/u);

    const schemaAudit = buildE2A9SchemaAudit();
    assert.equal(schemaAudit.operation_schema_count, 7);
    assert.equal(schemaAudit.retained_progression_schema_count, 3);
    assert.equal(schemaAudit.all_operation_schemas_compile, true);
    assert.equal(schemaAudit.all_retained_progression_schemas_compile, true);
    assert.equal(schemaAudit.all_provider_control_fields_absent, true);

    const compilation = await compileE2A9CandidateRequestsNoNetwork(
      path.join(tempRoot, "standalone-request-compilation.json")
    );
    assert.equal(compilation.artifact.role_count, 17);
    assert.equal(compilation.artifact.request_count, 26);
    assert.equal(compilation.artifact.operation_request_count, 7);
    assert.equal(compilation.artifact.retained_progression_request_count, 3);
    assert.equal(compilation.artifact.all_17_roles_compile, true);
    assert.equal(compilation.artifact.network_request_count, 0);
    assert.equal(
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH,
      originalApprovedHash
    );

    const adjudication = await executeE2A9Adjudication({
      artifact_root: path.join(tempRoot, "adjudication")
    });
    assert.equal(adjudication.status,
      "e2a9_passed_pending_v7_provider_canary");
    assert.equal(adjudication.manifest.all_13_outputs_adjudicated, true);
    assert.equal(adjudication.manifest.failed_regenerations_explained, true);
    assert.equal(adjudication.manifest.calibrated_evaluators_pass, true);
    assert.equal(adjudication.manifest.all_17_v7_roles_compile, true);
    assert.equal(adjudication.manifest.provider_call_count, 0);
    assert.equal(adjudication.manifest.protected_artifacts_unchanged, true);
    assert.equal(adjudication.manifest.v7_candidate_approved, false);
    assert.equal(adjudication.manifest.v7_candidate_activated, false);
    assert.equal(adjudication.manifest.human_review_status, "pending");
    assert.equal(artifactFiles(adjudication.run_directory).length, 14);

    const loaded = loadE2A9Adjudication(adjudication.run_directory);
    assert.equal(loaded.adjudication_rows.length, 13);
    assert.equal(loaded.replay_rows.length, 13);
    assert.equal(loaded.reporting.output_count, 13);
    assert.equal(loaded.reporting.original_v6_valid_output_count, 3);
    assert.equal(loaded.reporting.calibrated_valid_output_count, 8);
    assert.equal(loaded.reporting.genuine_failure_output_count, 5);
    assert.equal(loaded.reporting.false_positive_output_count, 5);
    assert.equal(loaded.reporting.aggregate_matches_output_rows, true);
    for (const row of loaded.adjudication_rows) {
      assert(row.human_review && typeof row.human_review === "object" &&
        !Array.isArray(row.human_review));
      const humanReview = row.human_review as Record<string, unknown>;
      assert.equal(humanReview.status, "pending");
      assert.equal(humanReview.pass, null);
      assert.equal(humanReview.score, null);
      assert(Array.isArray(row.proposed_adjudication));
      for (const classification of row.proposed_adjudication) {
        assert(E2A9_ADJUDICATION_CLASSES.includes(classification));
      }
    }
    const contextRows = readFileSync(
      path.join(adjudication.run_directory, "context-source-analysis.jsonl"),
      "utf8"
    ).trim().split("\n");
    assert.equal(contextRows.length, 5);
    assert(contextRows.every((line) => {
      const row = JSON.parse(line) as {
        v7_correction: Record<string, boolean>;
      };
      return row.v7_correction.progression_destination_fields_removed &&
        row.v7_correction.evaluation_only_source_versions_removed &&
        row.v7_correction.historical_visible_dialogue_preserved &&
        row.v7_correction.current_turn_directive_authoritative;
    }));
    const regeneration = loaded.regeneration_analysis;
    assert.equal(regeneration.failed_regeneration_case_count, 5);
    assert.equal(regeneration.same_generic_prompt_and_schema_reused, true);
    assert.equal(regeneration.selected_dialogue_operation_was_explicit, false);

    const protectedAfter = e2a9ProtectedArtifactSnapshot();
    assert.equal(protectedAfter.aggregate_sha256,
      protectedBefore.aggregate_sha256);
    assert.equal(networkCalls, 0);

    console.log(JSON.stringify({
      status: "passed",
      candidate_hash: E2A9_CANDIDATE_HASH,
      candidate_file_sha256: E2A9_CANDIDATE_FILE_SHA256,
      operation_count: TopicDialogueOperationSchema.options.length,
      held_out_case_count: heldOut.length,
      adjudicated_output_count: loaded.adjudication_rows.length,
      calibrated_valid_output_count:
        loaded.reporting.calibrated_valid_output_count,
      genuine_failure_output_count:
        loaded.reporting.genuine_failure_output_count,
      false_positive_output_count:
        loaded.reporting.false_positive_output_count,
      all_17_roles_compile: compilation.artifact.all_17_roles_compile,
      protected_artifacts_unchanged: true,
      provider_generation_call_count: 0,
      network_request_count: networkCalls,
      candidate_approved: false,
      candidate_activated: false,
      positive_purpose_count:
        Object.keys(TOPIC_DIALOGUE_OPERATION_POSITIVE_PURPOSES).length
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
