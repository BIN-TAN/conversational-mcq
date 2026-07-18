import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { FORMATIVE_EVALUATION_SCENARIOS } from "../src/lib/evaluation/formative/scenario-catalog";
import { runFormativeEvaluationScenario } from "../src/lib/evaluation/formative/runner";

loadEnvConfig(process.cwd());

async function main() {
  const scenario = FORMATIVE_EVALUATION_SCENARIOS.find((entry) => entry.scenario_id === "repeated_conceptual_confusion");
  if (!scenario) throw new Error("e2a_integration_scenario_missing");
  const prisma = new PrismaClient();
  const transitions: Array<{ prior: unknown; resulting: unknown; message: string; assistant: string | null }> = [];
  try {
    const result = await runFormativeEvaluationScenario({
      prisma,
      scenario,
      seed: 31_200,
      run_index: 1,
      fail_on_major: true,
      e2a_execution: {
        mode: "e2a_injected_no_live_test",
        expression_variant: 2,
        student_turn_renderer: async ({ turn }) => ({ message: `Honestly, ${turn.message}` }),
        on_operational_turn_completed: ({ turn, operational_assistant_response }) => {
          transitions.push({
            prior: structuredClone(turn.prior_state),
            resulting: structuredClone(turn.resulting_state),
            message: turn.message,
            assistant: operational_assistant_response
          });
        }
      }
    });
    if (result.manifest.provider_access_enabled) throw new Error("no_live_integration_marked_provider_enabled");
    if (result.operational_usage.length !== 0) throw new Error("no_live_integration_recorded_operational_provider_usage");
    if (result.artifacts.run_summary.provider_call_count !== 0) throw new Error("no_live_integration_dispatched_provider_call");
    if (result.artifacts.run_summary.critical_invariant_failure_count !== 0) throw new Error("no_live_integration_critical_invariant_failure");
    if (!result.artifacts.run_summary.fixture_cleaned) throw new Error("no_live_integration_fixture_not_cleaned");
    if (transitions.length !== result.artifacts.student_turns.length) throw new Error("no_live_integration_transition_count_mismatch");
    if (transitions.some((transition) => !transition.assistant)) throw new Error("no_live_integration_missing_assistant_response");
    for (const [index, transition] of transitions.entries()) {
      const stored = result.artifacts.student_turns[index];
      if (JSON.stringify(transition.prior) !== JSON.stringify(stored.prior_state)) throw new Error("no_live_integration_prior_state_changed");
      if (JSON.stringify(transition.resulting) !== JSON.stringify(stored.resulting_state)) throw new Error("no_live_integration_resulting_state_changed");
      if (!stored.message.startsWith("Honestly,")) throw new Error("no_live_integration_surface_message_not_used");
    }
    console.log(JSON.stringify({
      status: "passed",
      scenario_id: scenario.scenario_id,
      transition_count: transitions.length,
      hidden_state_preserved: true,
      assistant_replies_present: true,
      fixture_cleaned: true,
      provider_calls: 0
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "E2A integration smoke failed.");
  process.exitCode = 1;
});
