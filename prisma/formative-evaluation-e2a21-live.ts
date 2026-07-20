import { loadEnvConfig } from "@next/env";
import { executeLiveE2A21Canary } from
  "@/lib/evaluation/formative/e2a21-evidence-driven-micro-canary";
import {
  E2A21_BUDGET,
  E2A21_PROTOCOL_HASH
} from "@/lib/evaluation/formative/e2a21-protocol";
import {
  E2A17_CANDIDATE_FILE_SHA256,
  E2A17_CANDIDATE_HASH
} from "@/lib/evaluation/formative/e2a17-protocol";
import { E2A20_ORCHESTRATION_VERSION } from
  "@/lib/evaluation/formative/e2a20-evidence-driven-transition-adjudication";
import { E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION } from
  "@/lib/evaluation/formative/e2a20a-student-simulator-evidence-classifier-v3";

loadEnvConfig(process.cwd());

const CLASSIFIER_SHA256 =
  "9fd28385a6b70d72c02ec7e73adcc54d179e80226abda0edecad8771377bc899";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArgument(name: string, expected: string | number) {
  if (argument(name) !== String(expected)) {
    throw new Error(`e2a21_confirmation_mismatch:${name}`);
  }
}

async function main() {
  const flags = [
    "--confirm-e2a21-single-session-authorization",
    "--confirm-paid-provider-evaluation",
    "--confirm-single-isolated-session",
    "--confirm-sequential-concurrency-one",
    "--confirm-human-review-remains-pending",
    "--confirm-candidate-remains-unapproved",
    "--confirm-no-e2a17-rerun",
    "--confirm-no-e2a19-rerun",
    "--confirm-no-four-session-canary",
    "--confirm-no-36-session-matrix",
    "--confirm-no-e2b",
    "--confirm-stop-after-micro-canary"
  ];
  for (const flag of flags) {
    if (!process.argv.includes(flag)) {
      throw new Error(`e2a21_confirmation_missing:${flag}`);
    }
  }
  requireArgument("--candidate-hash", E2A17_CANDIDATE_HASH);
  requireArgument("--candidate-file-sha256", E2A17_CANDIDATE_FILE_SHA256);
  requireArgument("--classifier-version",
    E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION);
  requireArgument("--classifier-sha256", CLASSIFIER_SHA256);
  requireArgument("--orchestration-version", E2A20_ORCHESTRATION_VERSION);
  requireArgument("--protocol-hash", E2A21_PROTOCOL_HASH);
  requireArgument("--max-sessions", E2A21_BUDGET.maximum_sessions);
  requireArgument("--max-student-turns", E2A21_BUDGET.maximum_student_turns);
  requireArgument("--max-visible-dialogue-turns",
    E2A21_BUDGET.maximum_visible_dialogue_turns);
  requireArgument("--max-simulator-calls",
    E2A21_BUDGET.maximum_simulator_calls);
  requireArgument("--max-initial-tutor-calls",
    E2A21_BUDGET.maximum_tutor_initial_generation_calls);
  requireArgument("--max-tutor-regeneration-calls",
    E2A21_BUDGET.maximum_tutor_regeneration_calls);
  requireArgument("--max-total-logical-calls",
    E2A21_BUDGET.maximum_total_logical_generation_calls);
  requireArgument("--max-adapter-attempts",
    E2A21_BUDGET.maximum_provider_adapter_attempts);
  requireArgument("--max-input-tokens", E2A21_BUDGET.maximum_input_tokens);
  requireArgument("--max-output-tokens", E2A21_BUDGET.maximum_output_tokens);
  requireArgument("--max-total-tokens", E2A21_BUDGET.maximum_total_tokens);
  requireArgument("--max-cost-usd",
    E2A21_BUDGET.maximum_estimated_cost_usd_when_pricing_available);
  const checkpointCommit = argument("--checkpoint-commit");
  if (!checkpointCommit || !/^[a-f0-9]{40}$/u.test(checkpointCommit)) {
    throw new Error("e2a21_checkpoint_commit_invalid");
  }
  const result = await executeLiveE2A21Canary({ checkpointCommit });
  console.log(JSON.stringify({
    status: result.summary.status,
    run_id: result.runId,
    run_directory: result.runDir,
    candidate_hash: E2A17_CANDIDATE_HASH,
    candidate_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
    classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    classifier_sha256: CLASSIFIER_SHA256,
    orchestration_version: E2A20_ORCHESTRATION_VERSION,
    protocol_hash: E2A21_PROTOCOL_HASH,
    checkpoint_commit: checkpointCommit,
    session_outcome: result.summary.session_outcome,
    session_endpoint: result.summary.session_endpoint,
    persisted_student_turns: result.summary.persisted_student_turns,
    effective_tutor_replies: result.summary.effective_tutor_replies,
    provider_usage: result.summary.provider_usage,
    early_abort: result.summary.early_abort,
    human_review_item_count: result.summary.human_review_item_count,
    human_review_completed: false,
    candidate_approved: false,
    candidate_activated: false,
    e2a17_rerun: false,
    e2a19_rerun: false,
    four_session_canary_run: false,
    thirty_six_session_matrix_run: false,
    artifact_validation_passed: result.artifactValidation.passed
  }, null, 2));
  const safeOutcome = result.summary.status ===
      "e2a21_micro_canary_pass_required_endpoint_pending_human_review" ||
    result.summary.status ===
      "e2a21_micro_canary_complete_bounded_stop_pending_adjudication";
  if (!safeOutcome || !result.artifactValidation.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a21_live_micro_canary_failed");
  process.exitCode = 1;
});
