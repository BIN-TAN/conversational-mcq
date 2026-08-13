import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  StudentProfileOutput,
  ProductionStudentProfileOutput
} from "../src/lib/agents/contracts";
import { constraintsBlock } from "../src/lib/agents/prompts/shared/constraints";
import { compileProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import { canonicalStructuredAgentRequestHash } from "../src/lib/llm/provider-transport-retry";
import { FormativeConversationAgentOutputSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_V17_FAILURE_CLASSIFICATION,
  FORMATIVE_CONVERSATION_V17_IMMUTABLE_SOURCE,
  FORMATIVE_CONVERSATION_V17_PROFILING_FORENSICS
} from "../src/lib/operational/formative-conversation-v18/forensics";

const fixtureRoot = path.resolve(
  process.cwd(),
  "config/operational-candidates/formative-conversation-host-v5-executable-v17/fixtures"
);
const runRoot = path.resolve(
  process.cwd(),
  ".data/operational-formative-conversation-v5-evaluation-v17/runs",
  FORMATIVE_CONVERSATION_V17_IMMUTABLE_SOURCE.provider_run_id
);

const historicalPrompt = `You are the student_profiling_agent for a conversation-based MCQ formative assessment prototype.

Immutable constraints:
${constraintsBlock([
  "Produce ability, engagement, and integrated diagnostic profiles.",
  "Correctness is evidence, not the profile itself.",
  "Reasoning quality, confidence alignment, distractor rationale, transcript evidence, and process context all matter.",
  "Process data are contextual evidence for engagement and evidence sufficiency, not misconduct evidence.",
  "Never claim cheating, dishonesty, confirmed GenAI use, or misconduct.",
  "Use independent_understanding_uncertain when process evidence makes independent understanding uncertain.",
  "Use conservative language when evidence is incomplete or conflicting.",
  "When correctness, reasoning, confidence, and process evidence materially conflict and no single explanation is supported, use integrated_diagnostic_profile=conflicting_evidence_needs_clarification.",
  "Use correct_but_independence_uncertain only when product evidence is otherwise coherent and substantially correct and process evidence specifically limits confidence in independent understanding.",
  "In ability_pattern_flags and engagement_pattern_flags, no_clear_pattern is mutually exclusive with every specific pattern flag.",
  "Use guessing_possible only when there is actual evidence supporting possible guessing, not merely missing evidence.",
  "Use transfer_ready only when there is explicit transfer evidence or the profile is robust transfer-ready.",
  "Do not overclaim ability when evidence is missing.",
  "Do not infer motivation as a stable trait.",
  "Clearly separate observed evidence, diagnostic inference, uncertainty, and recommended next evidence.",
  "Return misconception_indicators, item_level_evidence, and recommended_next_evidence as arrays of strict structured objects with null for unavailable references.",
  "For every misconception indicator, return one or more semantic atomic_claims before formative conversation begins. Each atomic claim must state one misconception proposition and cite its source evidence references.",
  "A broad indicator may contain multiple atomic claims, but confidence, rationale, evidence metadata, limitations, uncertainty, and untested knowledge are not misconception claims.",
  "Do not assign indicator or claim IDs. The platform assigns stable identities only after this output passes validation.",
  "Use the exact locked enum labels.",
  "Return structured output only."
])}`;

function json(relativePath: string) {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}

function object(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function array(value: unknown) {
  assert(Array.isArray(value));
  return value;
}

function fileSha256(absolutePath: string) {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

function treeSha256(root: string) {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const absolutePath = path.join(directory, name);
      if (statSync(absolutePath).isDirectory()) {
        visit(absolutePath);
      } else {
        files.push(absolutePath);
      }
    }
  };
  visit(root);
  const lines = files
    .sort()
    .map(
      (absolutePath) =>
        `${fileSha256(absolutePath)}  ${path.relative(process.cwd(), absolutePath)}\n`
    )
    .join("");
  return createHash("sha256").update(lines).digest("hex");
}

function historicalRequest(caseId: string) {
  const fixture = json(
    path.relative(process.cwd(), path.join(fixtureRoot, `${caseId}.json`))
  );
  const invocationKey = `${FORMATIVE_CONVERSATION_V17_IMMUTABLE_SOURCE.derived_evaluation_id}:${caseId}:profiling`;
  return {
    agent_name: "student_profiling_agent",
    model_config: {
      model_name: "gpt-5.6-terra",
      reasoning_effort: "medium" as const,
      max_output_tokens: 4_000
    },
    instructions: historicalPrompt,
    input: fixture.provider_input,
    output_schema: StudentProfileOutput,
    schema_name: "student-profile-output-v3",
    client_request_id: `${invocationKey}:primary`,
    timeout_ms: 90_000,
    metadata: {
      evaluation_id:
        FORMATIVE_CONVERSATION_V17_IMMUTABLE_SOURCE.derived_evaluation_id,
      runtime_candidate_hash:
        FORMATIVE_CONVERSATION_V17_IMMUTABLE_SOURCE.runtime_candidate_hash,
      evaluation_protocol_hash:
        FORMATIVE_CONVERSATION_V17_IMMUTABLE_SOURCE.evaluation_protocol_hash,
      evaluation_runner_version:
        "formative-conversation-v5-protocol-runner-v17",
      approved_execution_role: "student_profiling_agent"
    }
  };
}

function assertExactHistoricalRequests() {
  let schemaRejection = "";
  for (const forensic of FORMATIVE_CONVERSATION_V17_PROFILING_FORENSICS) {
    const request = historicalRequest(forensic.case_id);
    assert.equal(
      canonicalStructuredAgentRequestHash(request),
      forensic.canonical_request_hash
    );
    try {
      compileProductionStructuredAgentRequest(request);
    } catch (error) {
      schemaRejection = error instanceof Error ? error.message : String(error);
    }
    assert.match(
      schemaRejection,
      /student-profile-output-v3\/properties\/misconception_indicators\/items\/properties\/atomic_claims/u
    );
    assert.match(
      schemaRejection,
      /`\.optional\(\)` without `\.nullable\(\)`/u
    );
  }

  const activeRequest = {
    ...historicalRequest(FORMATIVE_CONVERSATION_V17_PROFILING_FORENSICS[0].case_id),
    output_schema: ProductionStudentProfileOutput,
    schema_name: "student-profile-output-v4"
  };
  const compiled = compileProductionStructuredAgentRequest(activeRequest);
  assert.equal(object(object(compiled.text).format).name, "student-profile-output-v4");

  const historicalOfflineSmoke = readFileSync(
    path.resolve(
      process.cwd(),
      "prisma/formative-conversation-v17-profiling-canary-smoke-test.ts"
    ),
    "utf8"
  );
  assert.doesNotMatch(
    historicalOfflineSmoke,
    /compileProductionStructuredAgentRequest|zodTextFormat/u
  );
}

function assertImmutableProfilingEvidence() {
  assert.equal(
    treeSha256(runRoot),
    FORMATIVE_CONVERSATION_V17_IMMUTABLE_SOURCE.run_tree_sha256
  );
  for (const forensic of FORMATIVE_CONVERSATION_V17_PROFILING_FORENSICS) {
    const artifactPath = path.join(
      runRoot,
      "cases",
      `${forensic.case_id}-profiling.json`
    );
    assert.equal(fileSha256(artifactPath), forensic.immutable_artifact_sha256);
    const artifact = json(path.relative(process.cwd(), artifactPath));
    const validation = object(artifact.validation);
    assert.deepEqual(validation.issue_codes, ["schema:root"]);
    const audit = object(artifact.provider_execution_audit);
    const attempt = object(array(audit.attempts)[0]);
    assert.equal(attempt.canonical_request_hash, forensic.canonical_request_hash);
    assert.equal(attempt.result_status, "failed");
    assert.equal(attempt.input_tokens, null);
    assert.equal(attempt.output_tokens, null);
  }
}

function failedAgentCall(transcript: Record<string, unknown>) {
  return object(
    array(transcript.agent_calls).find(
      (entry) => object(entry).call_status !== "succeeded"
    )
  );
}

function assertImmutableCase5Evidence() {
  const transcriptPath = path.join(
    runRoot,
    "cases/fcv5_05_sound_profile_transition-transcript.json"
  );
  assert.equal(
    fileSha256(transcriptPath),
    "4b06fb28444b720a8360c279a9083e3389047e234a064cb3c5f1101b98315c20"
  );
  const failed = failedAgentCall(json(path.relative(process.cwd(), transcriptPath)));
  assert.equal(failed.typed_failure, "semantic_regeneration_not_permitted");
  assert.equal(failed.max_output_tokens, 3_500);
  const audit = object(failed.provider_execution_audit);
  assert.equal(audit.semantic_regeneration_count, 0);
  const attempt = object(array(audit.attempts)[0]);
  assert.equal(attempt.result_status, "incomplete");
  assert.equal(attempt.output_tokens, 3_500);
  assert.equal(
    attempt.provider_response_id,
    "resp_051d185a8e3cd737016a7c4fc94b28819ba831fe3b96436882"
  );
  const invalid = object(attempt.safe_invalid_output_evidence);
  assert.equal(invalid.validation_status, "invalid_json");
  assert.equal(invalid.output_presence, "text_only");
  const candidateText = String(invalid.candidate_text);
  assert.throws(() => JSON.parse(candidateText));
  assert.match(candidateText, /"claim_id":"mc_d354d58adc69d0bb$/u);
}

function assertImmutableCase6Evidence() {
  const transcriptPath = path.join(
    runRoot,
    "cases/fcv5_06_largely_improved_temporal-transcript.json"
  );
  assert.equal(
    fileSha256(transcriptPath),
    "0b31e713c81fef64f0d060e5c0a161540249caa7551b4a3be970648ab6460b68"
  );
  const failed = failedAgentCall(json(path.relative(process.cwd(), transcriptPath)));
  assert.equal(failed.typed_failure, "semantic_regeneration_exhausted");
  const attempts = array(object(failed.provider_execution_audit).attempts).map(object);
  assert.equal(attempts.length, 2);
  const primary = object(object(attempts[0].safe_invalid_output_evidence).candidate_json);
  assert.equal(FormativeConversationAgentOutputSchema.safeParse(primary).success, true);
  const primaryRecommendation = object(primary.profile_transition_recommendation);
  assert.equal(array(primaryRecommendation.misconception_claim_closure).length, 1);
  assert.deepEqual(object(attempts[0].safe_invalid_output_evidence).validation_issue_paths, [
    "profile_transition_recommendation.misconception_claim_closure:profile_transition_legacy_misconception_closure_forbidden"
  ]);

  const regenerated = object(
    object(attempts[1].safe_invalid_output_evidence).candidate_json
  );
  const recommendation = object(regenerated.profile_transition_recommendation);
  assert.deepEqual(recommendation.source_turn_sequence_indexes, [890, 892]);
  const independence = array(recommendation.field_evidence)
    .map(object)
    .find((entry) =>
      array(entry.profile_fields).includes("independence_interpretability")
    );
  assert(independence);
  assert.deepEqual(independence.source_turn_sequence_indexes, [891, 892]);
  assert.deepEqual(object(attempts[1].safe_invalid_output_evidence).validation_issue_paths, [
    "profile_transition_recommendation.field_evidence.3.source_turn_sequence_indexes.profile_transition_evidence_closure_violation"
  ]);
}

function assertImmutableControls() {
  for (const caseId of [
    "fcv5_07_persistent_barrier_teacher_assistance",
    "fcv5_08_mixed_resolved_evidence"
  ]) {
    const validation = json(
      path.relative(process.cwd(), path.join(runRoot, "cases", `${caseId}-validation.json`))
    );
    assert.equal(validation.status, "passed");
    assert.deepEqual(validation.deterministic_issue_codes, []);
  }
}

function main() {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("network_forbidden_in_v18_v17_forensic_replay");
  }) as typeof fetch;
  try {
    assertExactHistoricalRequests();
    const immutableRunAvailable = existsSync(runRoot);
    if (immutableRunAvailable) {
      assertImmutableProfilingEvidence();
      assertImmutableCase5Evidence();
      assertImmutableCase6Evidence();
      assertImmutableControls();
    }
    assert.equal(networkRequests, 0);
    console.log(
      JSON.stringify(
        {
          status: "passed",
          exact_v17_profiling_request_hashes_reconstructed: 3,
          exact_v17_strict_schema_rejection_reproduced: true,
          v17_offline_request_compiler_gap_confirmed: true,
          case_5_failure_class:
            FORMATIVE_CONVERSATION_V17_FAILURE_CLASSIFICATION.case_5
              .primary_failure_class,
          case_6_legacy_leak_and_evidence_closure_confirmed: true,
          passing_controls_confirmed: immutableRunAvailable,
          immutable_run_artifacts_available: immutableRunAvailable,
          provider_calls: 0,
          model_auth_requests: 0,
          network_requests: networkRequests,
          dispatch_checkpoints: 0
        },
        null,
        2
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main();
