import { loadEnvConfig } from "@next/env";
import { executeLiveE2A19Canary } from
  "@/lib/evaluation/formative/e2a19-single-session-micro-canary";
import {
  E2A19_BUDGET,
  E2A19_PROTOCOL_HASH
} from "@/lib/evaluation/formative/e2a19-protocol";
import {
  E2A17_CANDIDATE_FILE_SHA256,
  E2A17_CANDIDATE_HASH
} from "@/lib/evaluation/formative/e2a17-protocol";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArgument(name: string, expected: string | number) {
  if (argument(name) !== String(expected)) {
    throw new Error(`e2a19_confirmation_mismatch:${name}`);
  }
}

async function main() {
  const flags = [
    "--confirm-paid-provider-evaluation",
    "--confirm-single-isolated-session",
    "--confirm-sequential-concurrency-one",
    "--confirm-human-review-remains-pending",
    "--confirm-candidate-remains-unapproved",
    "--confirm-no-e2a17-rerun",
    "--confirm-no-four-session-canary",
    "--confirm-no-36-session-matrix",
    "--confirm-stop-after-micro-canary"
  ];
  for (const flag of flags) {
    if (!process.argv.includes(flag)) {
      throw new Error(`e2a19_confirmation_missing:${flag}`);
    }
  }
  requireArgument("--candidate-hash", E2A17_CANDIDATE_HASH);
  requireArgument("--candidate-file-sha256", E2A17_CANDIDATE_FILE_SHA256);
  requireArgument("--protocol-hash", E2A19_PROTOCOL_HASH);
  requireArgument("--max-sessions", E2A19_BUDGET.maximum_sessions);
  requireArgument("--max-simulator-calls",
    E2A19_BUDGET.maximum_simulator_calls);
  requireArgument("--max-initial-tutor-calls",
    E2A19_BUDGET.maximum_tutor_initial_generation_calls);
  requireArgument("--max-tutor-regeneration-calls",
    E2A19_BUDGET.maximum_tutor_regeneration_calls);
  requireArgument("--max-total-logical-calls",
    E2A19_BUDGET.maximum_total_logical_generation_calls);
  requireArgument("--max-adapter-attempts",
    E2A19_BUDGET.maximum_provider_adapter_attempts);
  requireArgument("--max-input-tokens", E2A19_BUDGET.maximum_input_tokens);
  requireArgument("--max-output-tokens", E2A19_BUDGET.maximum_output_tokens);
  requireArgument("--max-total-tokens", E2A19_BUDGET.maximum_total_tokens);
  requireArgument("--max-cost-usd",
    E2A19_BUDGET.maximum_estimated_cost_usd_when_pricing_available);
  const checkpointCommit = argument("--checkpoint-commit");
  if (!checkpointCommit || !/^[a-f0-9]{40}$/u.test(checkpointCommit)) {
    throw new Error("e2a19_checkpoint_commit_invalid");
  }
  const result = await executeLiveE2A19Canary({ checkpointCommit });
  console.log(JSON.stringify({
    status: result.summary.status,
    run_id: result.runId,
    run_directory: result.runDir,
    candidate_hash: E2A17_CANDIDATE_HASH,
    candidate_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
    protocol_hash: E2A19_PROTOCOL_HASH,
    checkpoint_commit: checkpointCommit,
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
    four_session_canary_run: false,
    thirty_six_session_matrix_run: false,
    artifact_validation_passed: result.artifactValidation.passed
  }, null, 2));
  if (result.summary.status !==
    "e2a19_micro_canary_pass_pending_human_review") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a19_live_micro_canary_failed");
  process.exitCode = 1;
});
