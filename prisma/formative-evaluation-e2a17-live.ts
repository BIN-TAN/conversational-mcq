import { loadEnvConfig } from "@next/env";
import {
  executeLiveE2A17Canary
} from "@/lib/evaluation/formative/e2a17-bounded-student-simulator-canary";
import {
  E2A17_BUDGET,
  E2A17_CANDIDATE_HASH,
  E2A17_PROTOCOL_HASH
} from "@/lib/evaluation/formative/e2a17-protocol";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArgument(name: string, expected: string | number) {
  if (argument(name) !== String(expected)) {
    throw new Error(`e2a17_confirmation_mismatch:${name}`);
  }
}

function requireBudget() {
  requireArgument("--max-sessions", E2A17_BUDGET.maximum_sessions);
  requireArgument("--max-simulator-calls",
    E2A17_BUDGET.maximum_simulator_calls);
  requireArgument("--max-initial-tutor-calls",
    E2A17_BUDGET.maximum_tutor_initial_generation_calls);
  requireArgument("--max-tutor-regeneration-calls",
    E2A17_BUDGET.maximum_tutor_regeneration_calls);
  requireArgument("--max-total-generation-calls",
    E2A17_BUDGET.maximum_total_generation_calls);
  requireArgument("--max-adapter-attempts",
    E2A17_BUDGET.maximum_provider_adapter_attempts);
  requireArgument("--max-input-tokens", E2A17_BUDGET.maximum_input_tokens);
  requireArgument("--max-output-tokens", E2A17_BUDGET.maximum_output_tokens);
  requireArgument("--max-total-tokens", E2A17_BUDGET.maximum_total_tokens);
  requireArgument("--max-cost-usd",
    E2A17_BUDGET.maximum_estimated_cost_usd_when_pricing_available);
}

async function main() {
  const flags = [
    "--confirm-paid-provider-evaluation",
    "--confirm-four-independent-sessions",
    "--confirm-sequential-concurrency-one",
    "--confirm-human-review-remains-pending",
    "--confirm-candidate-remains-unapproved",
    "--confirm-no-36-session-matrix",
    "--confirm-stop-after-canary"
  ];
  for (const flag of flags) {
    if (!process.argv.includes(flag)) {
      throw new Error(`e2a17_confirmation_missing:${flag}`);
    }
  }
  requireArgument("--candidate-hash", E2A17_CANDIDATE_HASH);
  requireArgument("--protocol-hash", E2A17_PROTOCOL_HASH);
  requireBudget();
  const checkpointCommit = argument("--checkpoint-commit");
  if (!checkpointCommit || !/^[a-f0-9]{40}$/u.test(checkpointCommit)) {
    throw new Error("e2a17_checkpoint_commit_invalid");
  }
  const result = await executeLiveE2A17Canary({ checkpointCommit });
  console.log(JSON.stringify({
    status: result.summary.status,
    run_id: result.runId,
    run_directory: result.runDir,
    candidate_hash: E2A17_CANDIDATE_HASH,
    protocol_hash: E2A17_PROTOCOL_HASH,
    checkpoint_commit: checkpointCommit,
    completed_session_count: result.summary.completed_session_count,
    student_turn_count: result.summary.student_turn_count,
    visible_tutor_reply_count: result.summary.visible_tutor_reply_count,
    provider_usage: result.summary.provider_usage,
    human_review_output_count: result.summary.human_review_output_count,
    human_review_completed: false,
    candidate_approved: false,
    candidate_activated: false,
    thirty_six_session_matrix_run: false,
    artifact_validation_passed: result.artifactValidation.passed
  }, null, 2));
  if (result.summary.status !==
    "e2a17_canary_pass_pending_human_review") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a17_live_canary_failed");
  process.exitCode = 1;
});
