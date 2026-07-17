import path from "node:path";
import { rmSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/db";
import { loadFormativeEvaluationScenario } from "../src/lib/evaluation/formative/scenario-loader";
import { runFormativeEvaluationScenario } from "../src/lib/evaluation/formative/runner";

loadEnvConfig(process.cwd());

const EXPECTED_RUNTIME_HASH = "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";
const artifactRoot = path.resolve(".data/formative-evaluation-e1-1-smoke");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runScenario(scenarioId: string, seed: number) {
  const result = await runFormativeEvaluationScenario({
    prisma,
    scenario: loadFormativeEvaluationScenario(scenarioId),
    seed,
    run_index: 1,
    artifact_dir: artifactRoot,
    keep_fixture_on_failure: false,
    fail_on_major: true
  });
  assert(result.manifest.provider_call_count === 0, `${scenarioId}: provider calls are forbidden.`);
  assert(
    result.manifest.operational_runtime_hash === EXPECTED_RUNTIME_HASH,
    `${scenarioId}: approved runtime hash changed.`
  );
  assert(result.artifacts.run_summary.passed, `${scenarioId}: scenario contract did not pass.`);
  return result.artifacts;
}

async function main() {
  rmSync(artifactRoot, { recursive: true, force: true });

  const repeated = await runScenario("repeated_conceptual_confusion", 1001);
  assert(
    repeated.run_summary.visible_assistant_reply_count === 3 &&
      repeated.run_summary.strategy_change_count >= 2,
    "repeated_confusion_requires_strategy_change: three replies and at least two strategy changes are required."
  );
  assert(
    repeated.run_summary.failed_expectations.every((finding) =>
      !/distractor|anchor|generic_tutoring/i.test(finding)
    ) &&
      repeated.visible_assistant_turns
        .filter((turn) => turn.client_operation_id)
        .every((turn) => /Item\s+\d+|option\s+[A-D]/i.test(turn.message_text)),
    "repeated_confusion_retains_distractor_anchor: every later reply must retain an item or option anchor."
  );

  const unsupported = await runScenario("unsupported_understanding_claim", 1003);
  const unsupportedLastReply = unsupported.visible_assistant_turns
    .filter((turn) => turn.client_operation_id)
    .at(-1);
  assert(
    unsupported.run_summary.premature_resolution_flag_count === 0 &&
      unsupported.run_summary.transfer_readiness_count === 0 &&
      unsupported.run_summary.final_hidden_state.misconception_status !== "resolved" &&
      unsupportedLastReply?.readiness_gate_reason === "unsupported_understanding_claim" &&
      /Item\s+\d+|option\s+[A-D]/i.test(unsupportedLastReply.message_text),
    "unsupported_understanding_requires_evidence: a bare claim must remain unresolved and elicit anchored evidence."
  );

  const recurrence = await runScenario("misconception_recurs_after_improvement", 1002);
  const recurrenceStatuses = recurrence.run_summary.final_hidden_state.evidence_history
    .filter((entry) => entry.evidence_type === "misconception_status")
    .map((entry) => entry.resulting_value);
  assert(
    recurrenceStatuses.includes("apparently_resolved") &&
      recurrenceStatuses.includes("recurred") &&
      recurrence.run_summary.visible_assistant_reply_count === 3,
    "apparent_resolution_can_reopen: contradictory evidence must reopen the formative episode."
  );

  const revisionTransfer = await runScenario("revision_succeeds_transfer_fails", 1004);
  assert(
    revisionTransfer.run_summary.revision_readiness_count === 1 &&
      revisionTransfer.run_summary.transfer_readiness_count === 1 &&
      revisionTransfer.run_summary.final_hidden_state.misconception_status === "recurred",
    "revision_success_does_not_imply_transfer_success: revision and failed transfer evidence must remain distinct."
  );
  assert(
    revisionTransfer.run_summary.transfer_readiness_count === 1,
    "required_transfer_is_presented: the required transfer branch was not reached."
  );
  assert(
    revisionTransfer.run_summary.final_platform_state === "formative_activity" &&
      revisionTransfer.run_summary.visible_assistant_reply_count === 2,
    "transfer_failure_returns_to_formative_dialogue: failed transfer must reopen a visible formative turn."
  );

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call_made: true,
    provider_call_count: 0,
    operational_runtime_hash: EXPECTED_RUNTIME_HASH,
    focused_tests: [
      "repeated_confusion_requires_strategy_change",
      "repeated_confusion_retains_distractor_anchor",
      "unsupported_understanding_requires_evidence",
      "apparent_resolution_can_reopen",
      "revision_success_does_not_imply_transfer_success",
      "required_transfer_is_presented",
      "transfer_failure_returns_to_formative_dialogue",
      "completed_idempotency_key_replays_cached_result",
      "new_key_after_terminal_is_rejected"
    ]
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
