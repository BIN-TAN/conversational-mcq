import { loadEnvConfig } from "@next/env";
import {
  E2A6_CANDIDATE_HASH,
  executeLiveE2A6V5TopicDialogueEvaluation,
  inspectE2A6Preflight
} from "@/lib/evaluation/formative/e2a6-v5-topic-dialogue-evaluation";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArgument(name: string, expected: string) {
  if (argument(name) !== expected) {
    throw new Error(`e2a6_confirmation_mismatch:${name}`);
  }
}

async function main() {
  if (!process.argv.includes("--confirm-paid-provider-evaluation")) {
    throw new Error("e2a6_paid_provider_confirmation_missing");
  }
  requireArgument("--candidate-hash", E2A6_CANDIDATE_HASH);
  requireArgument("--canary-max-cases", "5");
  requireArgument("--canary-max-calls", "15");
  requireArgument("--canary-max-cost-usd", "8");
  requireArgument("--full-max-cases", "30");
  requireArgument("--full-max-calls", "120");
  requireArgument("--full-max-cost-usd", "25");

  const preflight = await inspectE2A6Preflight({
    requireLiveEnvironment: true,
    requireCleanTree: true
  });
  if (!preflight.passed) {
    throw new Error(`e2a6_preflight_failed:${preflight.blockers.join(",")}`);
  }

  const result = await executeLiveE2A6V5TopicDialogueEvaluation();
  console.log(JSON.stringify({
    status: result.summary.final_evaluation_status,
    run_public_id: result.runPublicId,
    run_directory: result.runDir,
    candidate_hash: result.manifest.candidate_hash,
    dispatch_canary_passed: result.canary.passed,
    dispatch_canary_completed:
      result.summary.case_counts.dispatch_canary_completed,
    full_protocol_executed: result.summary.full_protocol_executed,
    full_protocol_completed: result.summary.case_counts.full_protocol_completed,
    full_protocol_skipped: result.summary.case_counts.full_protocol_skipped,
    generation_provider_calls:
      result.summary.provider_usage.generation_provider_calls,
    metadata_only_requests: result.summary.provider_usage.metadata_only_requests,
    input_tokens: result.summary.provider_usage.input_tokens,
    output_tokens: result.summary.provider_usage.output_tokens,
    reasoning_tokens: result.summary.provider_usage.reasoning_tokens,
    candidate_regenerations:
      result.summary.provider_usage.candidate_regenerations,
    estimated_cost_usd: result.summary.provider_usage.estimated_cost_usd,
    cost_status: result.summary.provider_usage.cost_status,
    human_review_status: result.summary.human_review_status,
    candidate_approved: false,
    candidate_activated: false
  }, null, 2));
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "e2a6_live_evaluation_failed"
  );
  process.exitCode = 1;
});
