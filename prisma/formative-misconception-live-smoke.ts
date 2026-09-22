import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { v18r2TestContext } from "./formative-conversation-v18r2-test-fixtures";

async function main() {
  assert.equal(process.env.RUN_LIVE_COVERAGE_SMOKE, "true", "Explicit opt-in is required for two synthetic live AI calls");
  loadEnvConfig(process.cwd());
  const { createLiveFormativeConversationV18R2AgentRunner } = await import(
    "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2"
  );
  const runner = createLiveFormativeConversationV18R2AgentRunner();
  const cases = [
    {
      name: "Reliability corrected; SEM still wrong",
      message: "I now understand reliability is consistency, not validity. For a hiring test we still need evidence about the intended job decisions. But SEM tells us the exact true score by subtracting the error from the observed score.",
      retainedClaimIndex: 1,
      expectedTopic: /\bSEM\b|standard error|true score|uncertainty/i
    },
    {
      name: "SEM corrected; validity still wrong",
      message: "SEM describes uncertainty around an observed score; it cannot recover an exact true score. The range is uncertain. But a highly reliable test is automatically valid for hiring because consistency proves the decisions are appropriate.",
      retainedClaimIndex: 0,
      expectedTopic: /validity|valid|reliability|reliable|consisten/i
    }
  ];
  for (const scenario of cases) {
    const context = v18r2TestContext({ student_turn_count: 1, max_student_turns: 30,
      student_messages: [scenario.message] });
    const execution = await runner.execute({ agent_call_db_id: "synthetic-live-coverage-check",
      invocation_key: `synthetic-coverage-${Date.now()}`, context });
    const output = execution.output as import("../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2").FormativeConversationV18R2AgentOutput;
    assert.notEqual(output.outcome, "sound_understanding", scenario.name);
    assert.equal(output.lifecycle_recommendation, "continue", scenario.name);
    const remainingId = context.allowed_misconception_claim_catalog.indicators[0].claims[scenario.retainedClaimIndex].claim_id;
    const disposition = output.profile_transition_recommendation?.misconception_claim_dispositions.find(claim => claim.claim_id === remainingId);
    assert.notEqual(disposition?.disposition, "resolved", scenario.name);
    assert.match(output.student_visible_message, scenario.expectedTopic, scenario.name);
    console.log(JSON.stringify({ scenario: scenario.name, passed: true, model: runner.identity.model_name,
      prompt_version: runner.identity.prompt_version, outcome: output.outcome,
      lifecycle: output.lifecycle_recommendation, message: output.student_visible_message,
      latency_ms: execution.latency_ms, total_tokens: execution.total_tokens,
      generation_source: execution.generation_source }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
