import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FormativeConversationV18R2AgentInputSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";
import { FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";

const report = JSON.parse(readFileSync(process.argv[2], "utf8")) as {
  prompt_sha256: string;
  results: Array<{ case_id: string; turn: number; context: unknown; output: unknown; accepted: boolean; attempts: Array<{ output: unknown }> }>;
};
const historicalPrompt = process.argv.includes("--historical-prompt");
if (!historicalPrompt) assert.equal(report.prompt_sha256, FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH);
let accepted = 0;
let rejected = 0;
for (const row of report.results) {
  const context = FormativeConversationV18R2AgentInputSchema.parse(row.context);
  assert(row.accepted);
  const validation = validateFormativeInterpretation({ candidate: row.output, context });
  assert(validation.valid, `${row.case_id}/${row.turn}: ${validation.validation_issue_paths.join(",")}`);
  accepted++;
  for (const attempt of row.attempts.slice(0, -1)) {
    assert(!validateFormativeInterpretation({ candidate: attempt.output, context }).valid, "Previously rejected substantive candidate stays rejected");
    rejected++;
  }
  if (row.turn > 1) {
    const previous = report.results.find(entry => entry.case_id === row.case_id && entry.turn === row.turn - 1)!;
    const prior = validateFormativeInterpretation({ candidate: previous.output, context: FormativeConversationV18R2AgentInputSchema.parse(previous.context) });
    assert.equal(context.visible_transcript.at(-2)?.message_text, prior.output!.student_visible_message, "Next context must contain exactly the previous displayed reply");
  }
}
console.log(JSON.stringify({ accepted_replayed: accepted, rejected_replayed: rejected, next_visible_message_chain: "verified", provider_calls: 0,
  generated_with_current_prompt: report.prompt_sha256 === FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH, historical_prompt_opt_in: historicalPrompt }));
