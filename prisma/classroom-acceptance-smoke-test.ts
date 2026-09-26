import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { evaluateClassroomAcceptance, ACCEPTANCE_REQUIREMENTS, CLASSROOM_ACCEPTANCE_VERSION, type ClassroomAcceptancePacket } from "../src/lib/evaluation/classroom-acceptance";
import { evaluatePedagogicalRubric } from "../src/lib/evaluation/formative/pedagogical-rubric";
import { loadFormativeEvaluationScenario } from "../src/lib/evaluation/formative/scenario-loader";
import { validateSemanticItemReviews } from "../src/lib/services/student-assessment/semantic-item-review";
import { validateChatNativeProfileStudentOutput, type ChatNativeFormativeProfileOutput } from "../src/lib/services/student-assessment/formative-profile";

const hash = "a".repeat(64);
const identity = { source_sha256: hash, assessment_sha256: hash, effective_model_config_sha256: hash,
  intended_use: "Synthetic test only", target_population: "Synthetic", decision_policy_sha256: hash };
const packet: ClassroomAcceptancePacket = { version: CLASSROOM_ACCEPTANCE_VERSION, identity,
  permitted_use: "teacher_supervised_formative_classroom",
  criteria_frozen_at: "2026-01-01T00:00:00Z", criteria_artifact_path: "synthetic/criteria.json", criteria_sha256: hash, unresolved_critical_findings: [],
  evidence: ACCEPTANCE_REQUIREMENTS.map(requirement => ({ requirement: requirement.id, kind: requirement.kind,
    status: "pass", identity, collected_at: "2026-01-02T00:00:00Z", criteria_sha256: hash,
    artifact_path: `synthetic/${requirement.id}.json`, artifact_sha256: hash, limitations: [],
    reviewer_ids: ["independent-a", "independent-b"], independent_review: true })) };
const check = (value: unknown, currentIdentity = identity, artifactHash: (path: string) => string | null = () => hash) =>
  evaluateClassroomAcceptance({ packet: value, currentIdentity, artifactHash, now: new Date("2026-01-03T00:00:00Z") });
assert.equal(check(packet).status, "ready_for_human_decision");
assert.equal(check(packet).high_stakes_authorized, false, "No automatic certification even with a complete synthetic packet");
assert.equal(check({}).status, "blocked");
assert.equal(check({ ...packet, permitted_use: "automated_grading" }).status, "blocked");
assert.equal(check(packet, { ...identity, source_sha256: "b".repeat(64) }).status, "blocked");
assert.equal(check(packet, identity, () => null).status, "blocked");
assert(check(packet, identity, path => path === packet.criteria_artifact_path ? null : hash).blockers.includes("criteria_artifact_missing_or_changed"));
for (const modify of [
  (p: ClassroomAcceptancePacket) => { p.evidence.pop(); },
  (p: ClassroomAcceptancePacket) => { p.evidence.push(p.evidence[0]); },
  (p: ClassroomAcceptancePacket) => { p.evidence[5].kind = "deterministic"; },
  (p: ClassroomAcceptancePacket) => { p.evidence[5].reviewer_ids = ["same", "same"]; },
  (p: ClassroomAcceptancePacket) => { p.evidence[5].independent_review = false; },
  (p: ClassroomAcceptancePacket) => { p.evidence[0].status = "not_run"; },
  (p: ClassroomAcceptancePacket) => { p.evidence[0].status = "fail"; },
  (p: ClassroomAcceptancePacket) => { p.evidence[0].collected_at = "2025-01-01T00:00:00Z"; },
  (p: ClassroomAcceptancePacket) => { p.evidence[0].collected_at = "2099-01-01T00:00:00Z"; },
  (p: ClassroomAcceptancePacket) => { p.evidence[0].criteria_sha256 = "b".repeat(64); },
  (p: ClassroomAcceptancePacket) => { p.evidence[0].identity = { ...identity, assessment_sha256: "b".repeat(64) }; },
  (p: ClassroomAcceptancePacket) => { p.unresolved_critical_findings = ["lost response"]; }
]) {
  const changed = structuredClone(packet); modify(changed); assert.equal(check(changed).status, "blocked");
}

const scenario = loadFormativeEvaluationScenario("correct_answer_robust_reasoning");
type RubricInput = Parameters<typeof evaluatePedagogicalRubric>[0];
const artifacts = { visible_turns: [], profile_history: [], plan_history: [],
  final_student_state: { evidence_history: [] } } as unknown as RubricInput["artifacts"];
for (const visible_turns of [[], [
  { actor_type: "student", client_operation_id: "x", sequence_index: 1, message_text: "A long unrelated answer that cannot demonstrate understanding." },
  { actor_type: "agent", client_operation_id: "x", sequence_index: 2, message_text: "Theta item difficulty option A. A factually wrong but keyword-rich reply." }
]]) {
  const rubric = evaluatePedagogicalRubric({ scenario, artifacts: { ...artifacts, visible_turns } as RubricInput["artifacts"], strategies: ["worked_example"], answer_key_leak_count: 0 });
  assert(rubric.every(entry => entry.score === null), "No positive educational scores from reply count, keywords, length, or absent observed violations");
}
const failed = evaluatePedagogicalRubric({ scenario, artifacts, strategies: [], answer_key_leak_count: 1 });
assert.equal(failed.find(entry => entry.dimension === "avoids_answer_dumping")?.score, 0);
const response = { item_public_id: "synthetic", reasoning_text_final: "A justified explanation." };
const review = { item_public_id: "synthetic", reasoning_quote: response.reasoning_text_final,
  reasoning_judgment: "supported_concise", explanation: "Synthetic review", misconceptions: [] };
assert.equal(validateSemanticItemReviews({ item_responses: [response] }, [review]).valid, true);
assert.equal(validateSemanticItemReviews({ item_responses: [response, response] }, [review]).valid, false);
assert.equal(validateSemanticItemReviews({ item_responses: [{ ...response, item_public_id: " " }] }, [{ ...review, item_public_id: " " }]).valid, false);

const profile: ChatNativeFormativeProfileOutput = {
  provisional_learning_state: "More evidence is needed.", main_issue: "Scale interpretation",
  formative_need: "scaffolding", matched_activity: "scaffolded_reasoning", evidence_used: ["Synthetic case"],
  confidence_calibration_flag: false, answer_reasoning_alignment: "Insufficient reasoning.",
  student_facing_pattern_statement: "Your explanation does not yet establish why the numerical codes support the proposed interpretation. ".repeat(3).trim(),
  student_facing_followup_prompt: "What additional evidence would support that interpretation of the response scale? ".repeat(7).trim(),
  should_reveal_correct_answer: false, next_expected_action: "respond_to_formative_activity"
};
const visible = validateChatNativeProfileStudentOutput({ output: profile, correct_options: [] });
assert.equal(visible.ok, true);
assert.equal(visible.student_facing_text, `${profile.student_facing_pattern_statement}\n\n${profile.student_facing_followup_prompt}`,
  "Do not clip a complete explanation or prompt, replace pronouns, or append unsupported praise");
for (const ending of ["an unfinished inference", "An unfinished inference...", "An unfinished inference\u2026"]) {
  const result = validateChatNativeProfileStudentOutput({ output: { ...profile, student_facing_pattern_statement: ending }, correct_options: [] });
  assert.equal(result.ok, false, "Incomplete student-facing text requires repair, not publication");
  assert(result.issues.some(issue => issue.rule_code === "student_message_incomplete"));
}

const directory = mkdtempSync(join(tmpdir(), "cmcq-acceptance-cli-"));
try {
  const root = join(directory, "evidence");
  mkdirSync(root);
  const content = "Synthetic CLI fixture, not validation evidence";
  const contentHash = createHash("sha256").update(content).digest("hex");
  writeFileSync(join(root, "record.txt"), content);
  writeFileSync(join(directory, "outside.txt"), content);
  symlinkSync(join(directory, "outside.txt"), join(root, "linked.txt"));
  writeFileSync(join(directory, "identity.json"), JSON.stringify(identity));
  const cliPacket = structuredClone(packet);
  cliPacket.criteria_artifact_path = "record.txt";
  cliPacket.criteria_sha256 = contentHash;
  for (const evidence of cliPacket.evidence) {
    evidence.artifact_path = "record.txt";
    evidence.artifact_sha256 = contentHash;
    evidence.criteria_sha256 = contentHash;
  }
  for (const [artifactPath, expectedStatus] of [["record.txt", 0], ["../outside.txt", 1], ["linked.txt", 1]] as const) {
    cliPacket.evidence[0].artifact_path = artifactPath;
    writeFileSync(join(directory, "packet.json"), JSON.stringify(cliPacket));
    const result = spawnSync(process.execPath, ["--import", "tsx", resolve("scripts/check-classroom-acceptance.ts"),
      join(directory, "packet.json"), join(directory, "identity.json"), root], { encoding: "utf8" });
    assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).high_stakes_authorized, false);
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log("PASS: acceptance fail-closed checks, pedagogical false-positive regression, and ambiguous source identity rejection. No high-stakes authorization.");
