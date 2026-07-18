import { loadEnvConfig } from "@next/env";
import {
  E2A4_CANDIDATE_HASH,
  executeLiveE2A4TopicDialogueEvaluation
} from "@/lib/evaluation/formative/e2a4-topic-dialogue-evaluation";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (!process.argv.includes("--confirm-paid-provider-evaluation")) {
    throw new Error("e2a4_paid_provider_confirmation_missing");
  }
  if (argument("--candidate-hash") !== E2A4_CANDIDATE_HASH) {
    throw new Error("e2a4_candidate_hash_confirmation_mismatch");
  }
  if (argument("--max-cases") !== "30") throw new Error("e2a4_case_limit_confirmation_mismatch");
  if (argument("--max-calls") !== "120") throw new Error("e2a4_call_limit_confirmation_mismatch");
  if (argument("--max-cost-usd") !== "25") throw new Error("e2a4_cost_limit_confirmation_mismatch");

  const result = await executeLiveE2A4TopicDialogueEvaluation();
  console.log(JSON.stringify({
    status: result.summary.final_evaluation_status,
    run_public_id: result.runPublicId,
    run_directory: result.runDir,
    dispatch_canary_passed: result.canary.passed,
    cases_completed: result.summary.case_counts.completed,
    cases_skipped: result.summary.case_counts.skipped,
    generation_provider_calls: result.summary.provider_usage.generation_provider_calls,
    metadata_only_requests: result.summary.provider_usage.metadata_only_requests,
    input_tokens: result.summary.provider_usage.input_tokens,
    output_tokens: result.summary.provider_usage.output_tokens,
    reasoning_tokens: result.summary.provider_usage.reasoning_tokens,
    retries: result.summary.provider_usage.retries,
    estimated_cost_usd: result.summary.provider_usage.estimated_cost_usd,
    human_review_status: result.summary.human_review_status,
    candidate_approved: false,
    candidate_activated: false
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a4_live_evaluation_failed");
  process.exitCode = 1;
});
