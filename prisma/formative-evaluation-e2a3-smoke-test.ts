import { readFileSync } from "node:fs";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";
import {
  E2A3_APPROVED_V2_HASH,
  E2A3_CANDIDATE_FILE_SHA256,
  E2A3_CANDIDATE_HASH,
  buildContextCoverage,
  executeE2A3TopicDialogueEvaluation,
  inspectE2A3CandidatePreflight,
  temporaryE2A3ArtifactRoot
} from "../src/lib/evaluation/formative/e2a3-topic-dialogue-evaluation";
import {
  e2a3EvaluationProtocolHash,
  e2a3TopicDialogueCases
} from "../src/lib/evaluation/formative/e2a3-topic-dialogue-protocol";
import {
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION,
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
  type TopicDialogueOutputV1
} from "../src/lib/services/student-assessment/topic-dialogue-agent";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class E2A3InjectedProvider implements LlmProvider {
  calls = 0;

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    this.calls += 1;
    const output: TopicDialogueOutputV1 = {
      dialogue_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION,
      schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
      tutor_message:
        "Use a new contrast: a coefficient can show consistent scores even when the intended interpretation lacks supporting evidence. What interpretation-specific claim in option A still needs separate evidence?",
      student_message_function: "substantive_answer",
      response_function: "worked_example",
      evidence_update: "The latest response still needs evidence tied to the reliability-validity boundary.",
      remaining_issue: "Reliability evidence alone does not establish validity.",
      post_turn_understanding: "partial",
      evidence_sufficiency: "needs_more_evidence",
      topic_relation: "current_assessment_content",
      topic_boundary: "inside_scope",
      system_question_answered: false,
      next_action: "await_topic_dialogue_response",
      next_runtime_state: "AWAIT_TOPIC_DIALOGUE_RESPONSE",
      progression_readiness: "not_ready",
      requires_student_response: true,
      expected_response_guidance: "Explain one interpretation-specific claim that needs separate evidence.",
      safety_flags: [],
      student_safe_summary: "The response remains focused on Item 2 option A and the reliability-validity boundary."
    };
    return {
      provider: "mock",
      client_request_id: request.client_request_id,
      provider_request_id: `test_request_${this.calls}`,
      provider_response_id: `test_response_${this.calls}`,
      status: "completed",
      parsed_output: request.output_schema.parse(output),
      usage: {
        input_tokens: 100,
        output_tokens: 100,
        total_tokens: 200,
        reasoning_tokens: 20,
        cached_input_tokens: 0
      },
      latency_ms: 5
    } as StructuredAgentResult<TOutput>;
  }
}

async function main() {
  const cases = e2a3TopicDialogueCases();
  assert(cases.length === 30, "E2A.3 must contain exactly 30 bounded cases.");
  assert(cases.filter((entry) => entry.expectation.tenth_turn).length === 18, "E2A.3 must contain 18 tenth-turn cases.");
  assert(cases.filter((entry) => !entry.expectation.tenth_turn).length === 12, "E2A.3 must contain 12 baseline or boundary cases.");
  assert(new Set(cases.map((entry) => entry.category)).size === 9, "All E2A.3 categories must be represented.");
  assert(e2a3EvaluationProtocolHash().length === 64, "Protocol hash must be stable SHA-256.");

  for (const testCase of cases.filter((entry) => entry.expectation.tenth_turn)) {
    const coverage = buildContextCoverage(testCase);
    assert(coverage.expected_visible_turn_ids.length === 18, `${testCase.case_id} must carry 18 prior visible turns.`);
    assert(coverage.missing_visible_turn_ids.length === 0, `${testCase.case_id} must not omit visible turns.`);
    assert(coverage.duplicated_visible_turn_ids.length === 0, `${testCase.case_id} must not duplicate visible turns.`);
    assert(coverage.order_matches, `${testCase.case_id} must preserve chronological order.`);
    assert(coverage.exact_content_matches, `${testCase.case_id} must preserve exact content.`);
    assert(coverage.latest_student_message_separate, `${testCase.case_id} must carry turn 10 separately.`);
    assert(coverage.initial_activity_present, `${testCase.case_id} must include the initial activity.`);
    assert(coverage.invisible_history_excluded, `${testCase.case_id} must exclude invisible drafts.`);
  }

  const preflight = inspectE2A3CandidatePreflight({ scanExistingEvidence: false });
  assert(preflight.passed, `Candidate preflight failed: ${preflight.blockers.join(",")}`);
  assert(preflight.candidate_hash === E2A3_CANDIDATE_HASH, "Candidate configuration hash changed.");
  assert(preflight.candidate_file_sha256 === E2A3_CANDIDATE_FILE_SHA256, "Candidate file SHA changed.");
  assert(preflight.approved_v2_hash === E2A3_APPROVED_V2_HASH, "Approved V2 hash changed.");
  assert(preflight.role_count === 17, "Candidate must retain the exact 17-role inventory.");
  assert(preflight.active_evidence_inheritance.inherited_role_count === 16, "Exactly 16 roles should inherit evidence.");
  assert(preflight.active_evidence_inheritance.approval_cli_supports_role_scoped_inheritance === false, "Role-scoped inheritance must not be presented as approval support.");

  const provider = new E2A3InjectedProvider();
  const artifactRoot = temporaryE2A3ArtifactRoot();
  const priorOptIn = process.env.EVAL_E2A3_LIVE_PROVIDER;
  const priorProvider = process.env.LLM_PROVIDER;
  const priorLive = process.env.LLM_LIVE_CALLS_ENABLED;
  delete process.env.EVAL_E2A3_LIVE_PROVIDER;
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  try {
    const run = await executeE2A3TopicDialogueEvaluation({
      provider,
      artifactRoot,
      live: false,
      skipProtectedSnapshotForTest: true
    });
    assert(provider.calls === 30, "Injected no-live provider must receive exactly one call per case.");
    assert(run.summary.automated_evaluation_passed, "Injected no-live evaluation should pass automated checks.");
    assert(run.summary.final_evaluation_status === "candidate_evaluation_incomplete", "Human review must remain pending.");
    assert(run.summary.approval_evidence_ready === false, "No-live smoke must not create approval evidence.");
    assert(run.summary.candidate_approved === false, "Candidate must remain unapproved.");
    assert(run.summary.candidate_activated === false, "Candidate must remain inactive.");
    for (const filePath of Object.values(run.paths)) {
      assert(readFileSync(filePath, "utf8").length > 0, `Required artifact is empty: ${filePath}`);
    }
    const outputText = readFileSync(run.paths.providerOutputs, "utf8");
    assert(!outputText.includes("OPENAI_API_KEY"), "Artifacts must not contain credentials.");
    assert(!outputText.includes("invisible draft"), "Artifacts must not contain hidden draft text.");
    assert(!outputText.includes("raw_output"), "Artifacts must not persist raw provider output.");
  } finally {
    if (priorOptIn === undefined) delete process.env.EVAL_E2A3_LIVE_PROVIDER;
    else process.env.EVAL_E2A3_LIVE_PROVIDER = priorOptIn;
    if (priorProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = priorProvider;
    if (priorLive === undefined) delete process.env.LLM_LIVE_CALLS_ENABLED;
    else process.env.LLM_LIVE_CALLS_ENABLED = priorLive;
  }

  console.log(JSON.stringify({
    status: "passed",
    case_count: cases.length,
    tenth_turn_case_count: 18,
    baseline_or_boundary_case_count: 12,
    provider_calls: 0,
    injected_provider_calls: provider.calls,
    candidate_approved: false,
    candidate_activated: false
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

