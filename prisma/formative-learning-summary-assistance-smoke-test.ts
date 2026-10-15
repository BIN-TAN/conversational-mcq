import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FormativeConversationV18R2AgentInput, FormativeConversationV18R2AgentOutput } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { learningSummaryEvidenceIssues, LEARNING_SUMMARY_POLICY_VERSION } from "../src/lib/services/student-assessment/formative-conversation/learning-summary-policy";
import { validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";

const fixturePath = path.join(process.cwd(), "prisma/fixtures/conversation-assisted-summary-native-v20.json");
const fixtureBytes = fs.readFileSync(fixturePath);
const text = fixtureBytes.toString("utf8");
const normalizedHash = (value: string) => createHash("sha256").update(value.replace(/\r\n/g, "\n")).digest("hex");
const fixture = JSON.parse(text) as {
  synthetic_only: boolean;
  real_student_records_used: boolean;
  context: FormativeConversationV18R2AgentInput;
  output: FormativeConversationV18R2AgentOutput;
  controls: Array<{ id: string; draft_message: string; replacement_latest_student_message?: string }>;
};
const original = JSON.stringify(fixture);
const context = fixture.context;
const firstId = "ev_e1004781fcc7859cac285596";
const secondId = "ev_f6a9fd70fdc4a450f6472a07";
const newId = "ev_a42b2844da722ef469fb7c76";
const baselineId = context.allowed_evidence_catalog.evidence.find(e => e.evidence_kind === "assessment_reasoning")!.evidence_id;
const understandingIssue = "learning_summary.learning_summary_understanding.recognition_requires_reconsideration";
const progressIssue = "learning_summary.learning_summary_progress.recognition_requires_reconsideration";
type Observation = FormativeConversationV18R2AgentOutput["evidence_observations"][number];
let checks = 0;
function check(name: string, run: () => void) { run(); checks++; console.log(`PASS ${name}`); }
function observation(evidence_type: string, evidence_ids: string[]): Observation {
  return { evidence_type, evidence_ids, observation: "Authored source-bound comparison; substantive accuracy is separately reviewed." };
}
function candidate(type: string, ids: string[]) {
  const result = structuredClone(fixture.output);
  result.student_visible_message = "A source-bound summary control.";
  result.evidence_observations = [observation(type, ids)];
  return result;
}
function history(type: string, ids: string[], sequence: number) {
  return { ...context.assistance_history!.observations[0], ...observation(type, ids), source_tutor_sequence_index: sequence };
}
function issues(output: FormativeConversationV18R2AgentOutput, input = context) { return learningSummaryEvidenceIssues(output, input); }

check("Exact synthetic native fixture and CRLF-portable formatting fingerprint", () => {
  assert.equal(fixture.synthetic_only, true);
  assert.equal(fixture.real_student_records_used, false);
  assert.equal(normalizedHash(text), "bb3c908e129877871d6e8e57e15153f0a188dda0bfcb368b6e102231db74c85b");
  assert.equal(normalizedHash(text.replace(/\r?\n/g, "\r\n")), normalizedHash(text));
  assert.equal(LEARNING_SUMMARY_POLICY_VERSION, "learning-summary-evidence-v2");
});
check("Exact originally delivered native closing is now rejected without changing its text or profile", () => {
  assert(issues(fixture.output).includes(understandingIssue));
  assert(validateFormativeInterpretation({ candidate: fixture.output, context }).validation_issue_paths.includes(understandingIssue));
  assert.equal(fixture.output.profile_transition_recommendation, null);
});
for (const id of [firstId, secondId]) {
  check(`Each historically qualified positive claim remains limited: ${id}`, () => {
    assert(issues(candidate("learning_summary_understanding", [id])).includes(understandingIssue));
  });
}
check("Unrelated unqualified baseline cannot launder a qualified understanding claim", () => {
  assert(issues(candidate("learning_summary_understanding", [baselineId, firstId])).includes(understandingIssue));
});
check("Unqualified baseline understanding remains eligible on its own", () => {
  assert.deepEqual(issues(candidate("learning_summary_understanding", [baselineId])), []);
});
for (const type of ["supported_reasoning_recognition", "support_limitation", "understanding_not_demonstrated"]) {
  check(`Current ${type} cannot be relabeled positive in the same call`, () => {
    const output = candidate("learning_summary_understanding", [newId]);
    output.evidence_observations.push(observation(type, [newId]));
    assert(issues(output).includes(understandingIssue));
  });
}
check("Mixed historical and current qualification both survive", () => {
  const output = candidate("learning_summary_understanding", [firstId, newId]);
  output.evidence_observations.push(observation("supported_recognition", [newId]));
  output.evidence_observations.push(observation("assistance_context_reconsidered", [firstId]));
  assert(issues(output).includes(understandingIssue));
});
check("An accurately assisted recap with recognition observations remains allowed", () => {
  const output = candidate("supported_reasoning_recognition", [firstId, secondId]);
  output.student_visible_message = fixture.controls[0].draft_message;
  assert.deepEqual(issues(output), []);
});
check("Remaining difficulty and explicit stop do not require a positive learning claim", () => {
  const output = candidate("learning_summary_remaining", [secondId]);
  output.student_visible_message = "We can stop here. SEM remains the topic you asked to revisit.";
  output.lifecycle_recommendation = "complete";
  const before = JSON.stringify(output);
  assert.deepEqual(issues(output), []);
  assert.equal(JSON.stringify(output), before);
  output.lifecycle_recommendation = "pause";
  assert.deepEqual(issues(output), []);
});
check("Baseline comparison cannot launder a qualified later progress claim", () => {
  assert(issues(candidate("learning_summary_progress", [baselineId, secondId])).includes(progressIssue));
});
check("Earlier unqualified formative evidence cannot launder a qualified later progress claim", () => {
  const earlier = context.allowed_evidence_catalog.evidence.find(e => e.source_sequence_index === 30)!.evidence_id;
  assert(issues(candidate("learning_summary_progress", [earlier, secondId])).includes(progressIssue));
});
check("Qualified earlier comparison does not bar genuinely later reasoning", () => {
  const later = structuredClone(context);
  const written = fixture.controls[1].replacement_latest_student_message!;
  assert(written);
  later.allowed_evidence_catalog.evidence.find(e => e.evidence_id === newId)!.content = written;
  const output = candidate("learning_summary_progress", [firstId, newId]);
  output.student_visible_message = fixture.controls[1].draft_message;
  assert.deepEqual(issues(output, later), []);
  assert.deepEqual(issues(candidate("learning_summary_understanding", [newId]), later), []);
});
check("Current qualification on the latest after-evidence still blocks progress", () => {
  const output = candidate("learning_summary_progress", [firstId, newId]);
  output.evidence_observations.push(observation("supported_recognition", [newId]));
  assert(issues(output).includes(progressIssue));
});
check("Progress still needs a real before/after pair", () => {
  assert(issues(candidate("learning_summary_progress", [newId])).includes("learning_summary.learning_summary_progress.before_and_after_required"));
});
check("Current same-ID source-bound reconsideration can correct an earlier interpretation", () => {
  const output = candidate("learning_summary_understanding", [firstId]);
  output.evidence_observations.push(observation("assistance_context_reconsidered", [firstId]));
  assert.deepEqual(issues(output), []);
});
check("Reconsidering a different ID cannot lift the original qualification", () => {
  const output = candidate("learning_summary_understanding", [firstId]);
  output.evidence_observations.push(observation("assistance_context_reconsidered", [secondId]));
  assert(issues(output).includes(understandingIssue));
});
check("A reconsideration with an unknown extra ID cannot waive known source limits", () => {
  const output = candidate("learning_summary_understanding", [firstId]);
  output.evidence_observations.push(observation("assistance_context_reconsidered", [firstId, "ev_ffffffffffffffffffffffff"]));
  assert(issues(output).includes(understandingIssue));
});
check("Persisted later reconsideration lifts only its same-ID earlier qualification", () => {
  const input = structuredClone(context);
  input.assistance_history!.observations.push(history("assistance_context_reconsidered", [firstId], 35));
  assert.deepEqual(issues(candidate("learning_summary_understanding", [firstId]), input), []);
  assert(issues(candidate("learning_summary_understanding", [secondId]), input).includes(understandingIssue));
});
check("Requalification after persisted reconsideration restores the limit", () => {
  const input = structuredClone(context);
  input.assistance_history!.observations.push(history("assistance_context_reconsidered", [firstId], 35), history("supported_recognition", [firstId], 37));
  assert(issues(candidate("learning_summary_understanding", [firstId]), input).includes(understandingIssue));
});
check("Historical order in the array does not replace source-turn chronology", () => {
  const input = structuredClone(context);
  input.assistance_history!.observations.unshift(history("assistance_context_reconsidered", [firstId], 35));
  assert.deepEqual(issues(candidate("learning_summary_understanding", [firstId]), input), []);
});
check("Same-turn contradictory reconsideration cannot cancel recognition by array order", () => {
  for (const reverse of [false, true]) {
    const output = candidate("learning_summary_understanding", [newId]);
    const pair = [observation("supported_recognition", [newId]), observation("assistance_context_reconsidered", [newId])];
    output.evidence_observations.push(...(reverse ? pair.reverse() : pair));
    assert(issues(output).includes(understandingIssue));
  }
});
check("Current qualification survives an older persisted reconsideration", () => {
  const input = structuredClone(context);
  input.assistance_history!.observations.push(history("assistance_context_reconsidered", [firstId], 35));
  const output = candidate("learning_summary_understanding", [firstId]);
  output.evidence_observations.push(observation("supported_recognition", [firstId]));
  assert(issues(output, input).includes(understandingIssue));
});
for (const kind of ["foreign", "tutor", "request"] as const) {
  check(`Reconsideration cannot bypass existing ${kind} source restrictions`, () => {
    const input = structuredClone(context);
    const entry = input.allowed_evidence_catalog.evidence.find(e => e.evidence_id === firstId)!;
    if (kind === "foreign") entry.conversation_public_id = "another-conversation";
    if (kind === "tutor") entry.source_role = "tutor";
    if (kind === "request") entry.eligibility = "evidence_quality_context";
    const output = candidate("learning_summary_understanding", [firstId]);
    output.evidence_observations.push(observation("assistance_context_reconsidered", [firstId]));
    assert(issues(output, input).includes("learning_summary.learning_summary_understanding.student_reasoning_required"));
  });
}
check("Absent historical assistance remains unknown rather than automatically disqualifying evidence", () => {
  const input = structuredClone(context);
  delete input.assistance_history;
  assert.deepEqual(issues(candidate("learning_summary_understanding", [firstId]), input), []);
});
check("All inputs, native records and fixture bytes remain unchanged", () => {
  assert.equal(JSON.stringify(fixture), original);
  assert.deepEqual(fs.readFileSync(fixturePath), fixtureBytes);
});
console.log(`${checks} learning-summary assistance checks passed. Synthetic only; no provider or database calls.`);
