import { loadEnvConfig } from "@next/env";
import {
  E2A3_CANDIDATE_FILE_SHA256,
  E2A3_CANDIDATE_HASH,
  executeLiveE2A3TopicDialogueEvaluation,
  inspectE2A3CandidatePreflight
} from "../src/lib/evaluation/formative/e2a3-topic-dialogue-evaluation";
import { e2a3EvaluationProtocolHash } from "../src/lib/evaluation/formative/e2a3-topic-dialogue-protocol";

loadEnvConfig(process.cwd());

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.env.EVAL_E2A3_LIVE_PROVIDER !== "1") {
    console.log(JSON.stringify({
      status: "skipped",
      reason: "EVAL_E2A3_LIVE_PROVIDER is not 1",
      no_provider_call: true
    }, null, 2));
    return;
  }
  if (!process.argv.includes("--confirm-paid-api")) {
    throw new Error("e2a3_confirm_paid_api_required");
  }
  if (argValue("--expected-candidate-hash") !== E2A3_CANDIDATE_HASH) {
    throw new Error("e2a3_expected_candidate_hash_mismatch");
  }
  if (argValue("--expected-candidate-file-sha256") !== E2A3_CANDIDATE_FILE_SHA256) {
    throw new Error("e2a3_expected_candidate_file_sha256_mismatch");
  }
  if (argValue("--expected-evaluation-protocol-hash") !== e2a3EvaluationProtocolHash()) {
    throw new Error("e2a3_expected_evaluation_protocol_hash_mismatch");
  }
  if (!process.argv.includes("--new-run")) {
    throw new Error("e2a3_new_run_confirmation_required");
  }
  const preflight = inspectE2A3CandidatePreflight({
    requireCleanTree: true,
    requireLiveEnvironment: true
  });
  if (!preflight.passed) {
    throw new Error(`e2a3_preflight_failed:${preflight.blockers.join(",")}`);
  }
  const result = await executeLiveE2A3TopicDialogueEvaluation();
  console.log(JSON.stringify({
    status: result.summary.final_evaluation_status,
    run_public_id: result.runPublicId,
    artifact_directory: result.runDir,
    candidate_hash: result.summary.candidate_hash,
    approved_v2_hash: result.summary.approved_v2_hash,
    case_counts: result.summary.case_counts,
    context_coverage: result.summary.context_coverage,
    provider_usage: result.summary.provider_usage,
    human_review_status: result.summary.human_review_status,
    candidate_approved: false,
    candidate_activated: false,
    e2a_canary_executed: false
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "candidate_evaluation_incomplete",
    reason: error instanceof Error ? error.message : "unknown_e2a3_live_failure",
    credentials_printed: false
  }, null, 2));
  process.exit(1);
});

