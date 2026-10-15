import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AgentInputByName, AgentOutputByName } from "../src/lib/agents/contracts";
import { ProductionStudentProfileOutputV6, ProductionStudentProfilingInput } from "../src/lib/agents/contracts";
import { executeStudentProfileWithSemanticRepair, studentProfileReusableInvocationKeys } from "../src/lib/agents/student-profiling/semantic-repair";
import { validateStudentProfileOutputSemantics } from "../src/lib/agents/student-profiling/semantic-validation";

type Input = AgentInputByName["student_profiling_agent"];
type Output = AgentOutputByName["student_profiling_agent"];
type Request = Parameters<typeof executeStudentProfileWithSemanticRepair>[0]["request"];
type Feedback = {
  policy_version: string; attempt: number; maximum_regenerations: number; validation_issues: string[];
  rejected_field_diagnostics: {
    provenance: string; ability_pattern_flags: string[];
    item_comparisons: Array<{ item_public_id: string; sealed_correctness: string | null;
      rejected_item_entry_count: number; rejected_reasoning_assessments: Array<string | null> }>;
  };
};
const raw = readFileSync("prisma/fixtures/student-profile-mismatch-native-v18.json");
// Git may convert the JSON file's formatting to CRLF on Windows. Escaped
// source-string values and the original native artifact hash remain untouched.
const fixtureTextHash = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
assert.equal(fixtureTextHash(raw.toString("utf8")), "8519601ec225ab20bc0b0578e0f1e7417653ba3e0bde12692af06d62db8cbf09");
assert.equal(fixtureTextHash(raw.toString("utf8").replace(/\r?\n/g, "\r\n")), fixtureTextHash(raw.toString("utf8")));
const fixture = JSON.parse(raw.toString("utf8")) as { synthetic_only: boolean; drafts: Array<{
  disposition: string; input: Input; output: Output; validation_error: string;
}> };
assert.equal(fixture.synthetic_only, true);
const before = JSON.stringify(fixture);
let checks = 0;
const check = (fn: () => void) => { fn(); checks++; };
const semantic = (input: Input, output: Output) => validateStudentProfileOutputSemantics({ providerInput: input, output });
const first = fixture.drafts[0];
const second = fixture.drafts[1];
for (const draft of fixture.drafts) {
  check(() => assert.equal(draft.disposition, "rejected"));
  check(() => assert(ProductionStudentProfilingInput.safeParse(draft.input).success));
  check(() => assert(ProductionStudentProfileOutputV6.safeParse(draft.output).success));
  check(() => assert(semantic(draft.input, draft.output).issues.some(issue => issue.includes("incorrect answers with incorrect explanations alone"))));
}
check(() => assert(semantic(first.input, first.output).issues.some(issue => issue.includes("evidence_reference"))));
check(() => assert(!semantic(second.input, second.output).issues.some(issue => issue.includes("evidence_reference"))));

// Authored control, not a retrospectively accepted model draft. Change only the
// unsupported flag from the second actual output; all student evidence stays exact.
const authoredCorrected = structuredClone(second.output);
authoredCorrected.ability_pattern_flags = authoredCorrected.ability_pattern_flags.filter(flag => flag !== "correctness_reasoning_mismatch");
check(() => assert(semantic(second.input, authoredCorrected).ok));
const request: Request = { agentName: "student_profiling_agent", invocationKey: "synthetic_native_mismatch",
  allowlistedInput: first.input, operationalContext: {} };
function feedback(request: Request) {
  return request.allowlistedInput.profiling_constraints.semantic_repair as Feedback;
}

async function run() {
  const requests: Request[] = [], rejected: Output[] = [];
  const repaired = await executeStudentProfileWithSemanticRepair({ request,
    execute: async value => { requests.push(value); return { status: "succeeded", agent_call_id: `synthetic_${requests.length}`,
      output: requests.length === 1 ? first.output : authoredCorrected, retry_count: 0 }; },
    recordRejected: async result => { rejected.push(result.output); }
  });
  check(() => assert.equal(repaired.status, "succeeded"));
  check(() => assert.equal(requests.length, 2));
  check(() => assert.deepEqual(rejected, [first.output]));
  const repair = requests[1], details = feedback(repair);
  check(() => assert.equal(details.policy_version, "student-profile-semantic-repair-v2"));
  check(() => assert.equal(details.attempt, 1));
  check(() => assert.equal(details.maximum_regenerations, 1));
  check(() => assert.deepEqual(details.validation_issues, semantic(first.input, first.output).issues));
  check(() => assert.deepEqual(details.rejected_field_diagnostics.ability_pattern_flags, first.output.ability_pattern_flags));
  check(() => assert.deepEqual(details.rejected_field_diagnostics.item_comparisons, first.output.item_level_evidence.map(item => ({
    item_public_id: item.item_public_id, sealed_correctness: "incorrect", rejected_item_entry_count: 1,
    rejected_reasoning_assessments: ["incorrect_explanation"]
  }))));
  check(() => assert.deepEqual(repair.allowlistedInput.initial_response_package, first.input.initial_response_package));
  check(() => assert.deepEqual(repair.allowlistedInput.allowed_evidence_catalog, first.input.allowed_evidence_catalog));
  check(() => assert.deepEqual(repair.allowlistedInput.followup_evidence_package, first.input.followup_evidence_package));
  check(() => assert.equal(repair.invocationKey, "synthetic_native_mismatch:semantic-repair:1"));
  check(() => assert.equal(repair.forceNewInvocation, false));

  requests.length = 0;
  const exhausted = await executeStudentProfileWithSemanticRepair({ request,
    execute: async value => { requests.push(value); return { status: "succeeded", agent_call_id: `bad_${requests.length}`,
      output: requests.length === 1 ? first.output : second.output, retry_count: 0 }; }, recordRejected: async () => {}
  });
  check(() => assert.equal(exhausted.status, "semantic_validation_failed"));
  check(() => assert.equal(requests.length, 2));

  // An interrupted earlier rejection resumes the same deterministic repair key;
  // changing feedback version neither redispatches the base nor grants a third try.
  requests.length = 0;
  const retained = { agent_call_id: "retained_base", provider_input: first.input, output: first.output };
  const resumed = await executeStudentProfileWithSemanticRepair({ request,
    readPriorSemanticRejection: async () => retained,
    execute: async value => { requests.push(value); return { status: "succeeded", agent_call_id: "retained_repair",
      output: authoredCorrected, retry_count: 0, idempotent_replay: true }; }, recordRejected: async () => {}
  });
  check(() => assert.equal(resumed.status, "succeeded"));
  check(() => assert.equal(requests.length, 1));
  check(() => assert.equal(requests[0].invocationKey, repair.invocationKey));
  check(() => assert.deepEqual(feedback(requests[0]), details));
  check(() => assert.deepEqual(studentProfileReusableInvocationKeys(request.invocationKey!), ["synthetic_native_mismatch", repair.invocationKey]));
  requests.length = 0;
  const alreadyFailed = await executeStudentProfileWithSemanticRepair({ request,
    readPriorSemanticRejection: async () => retained,
    execute: async value => { requests.push(value); return { status: "failed", agent_call_id: "retained_failed_repair", retry_count: 0,
      error: { category: "invalid_request", message: "Existing repair is not replayable", retryable: false } }; }, recordRejected: async () => {}
  });
  check(() => assert.equal(alreadyFailed.status, "semantic_validation_failed"));
  check(() => assert.equal(requests.length, 1));
  check(() => assert.equal(requests[0].invocationKey, repair.invocationKey));
  const invalidIdentity = await executeStudentProfileWithSemanticRepair({ request,
    readPriorSemanticRejection: async () => ({ agent_call_id: "wrong_identity", provider_input: null, output: null }),
    execute: async () => { throw Error("Invalid retained identity must not dispatch"); }, recordRejected: async () => {}
  });
  check(() => assert.equal(invalidIdentity.status, "semantic_validation_failed"));

  // Unknown/conflicting submitted correctness stays unknown. A rejected model
  // cannot add a feedback item or hide its duplicate/conflicting assessments.
  const conflictInput = structuredClone(first.input);
  const payload = conflictInput.initial_response_package.payload as { item_responses: Array<Record<string, unknown>> };
  payload.item_responses.push({ ...payload.item_responses[0], correctness: "correct" });
  const conflictOutput = structuredClone(first.output);
  const duplicate = structuredClone(conflictOutput.item_level_evidence[0]);
  duplicate.reasoning_basis!.assessment = "adequate_for_item";
  conflictOutput.item_level_evidence.push(duplicate, structuredClone(duplicate));
  conflictOutput.item_level_evidence.push({ ...structuredClone(duplicate), item_public_id: "invented_item" });
  let captured: Request | null = null;
  await executeStudentProfileWithSemanticRepair({ request: { ...request, allowlistedInput: conflictInput },
    readPriorSemanticRejection: async () => ({ agent_call_id: "conflicting", provider_input: conflictInput, output: conflictOutput }),
    execute: async value => { captured = value; return { status: "failed", retry_count: 0,
      error: { category: "invalid_request", message: "Offline stop", retryable: false } }; }, recordRejected: async () => {}
  });
  assert(captured);
  const rows = feedback(captured).rejected_field_diagnostics.item_comparisons;
  check(() => assert.equal(rows.length, 3));
  check(() => assert.equal(rows[0].sealed_correctness, null));
  check(() => assert.equal(rows[0].rejected_item_entry_count, 3));
  check(() => assert.deepEqual(rows[0].rejected_reasoning_assessments, ["incorrect_explanation", "adequate_for_item"]));
  check(() => assert(!rows.some(row => row.item_public_id === "invented_item")));
  check(() => assert.equal(JSON.stringify(fixture), before));
  console.log(`PASS ${checks} rejected-native profiling feedback and bounded-resume checks; no provider or database calls.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
