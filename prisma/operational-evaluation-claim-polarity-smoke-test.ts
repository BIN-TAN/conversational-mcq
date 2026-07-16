import { loadEnvConfig } from "@next/env";
import {
  evaluateCandidateOutputPolicy,
  modelUpgradeEvaluationFixtures,
  type CandidateEvaluationOutput
} from "../src/lib/operational/model-upgrade-evaluation";
import { assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

const fixture = modelUpgradeEvaluationFixtures().find((entry) => entry.fixture_id === "student_profiling_specific_misconception");
assert(fixture, "Claim polarity fixture missing.");
const claimFixture = fixture;

function output(text: string): CandidateEvaluationOutput {
  return {
    fixture_id: claimFixture.fixture_id,
    role: claimFixture.role,
    response_status: "answered",
    output_kind: "student_facing",
    response_summary: "Claim polarity test.",
    student_facing_text: text,
    teacher_facing_text: null,
    decision_summary: "Safe decision.",
    evidence_used: ["synthetic fixture"],
    safety_notes: [],
    next_action: null,
    confidence: "medium"
  };
}

function main() {
  const blocked = evaluateCandidateOutputPolicy(output("The student is unmotivated."), claimFixture);
  assert(blocked.unsupported_claims.length === 1, "Affirmative unsupported motivation claim should be blocked.");
  assert(blocked.safety_finding_details[0]?.assertion_polarity === "affirmative", "Blocked claim should record affirmative polarity.");
  assert(blocked.safety_finding_details[0]?.exact_text_span.toLowerCase() === "unmotivated", "Blocked claim should record exact span.");

  const negated = evaluateCandidateOutputPolicy(output("No inference about motivation is warranted."), claimFixture);
  assert(negated.unsupported_claims.length === 0, "Negated motivation statement should be allowed.");

  const prohibition = evaluateCandidateOutputPolicy(output("Do not infer motivation from this response."), claimFixture);
  assert(prohibition.unsupported_claims.length === 0, "Prohibition statement should be allowed.");

  const audit = evaluateCandidateOutputPolicy(output("Audit note: this response does not establish stable ability."), claimFixture);
  assert(audit.unsupported_claims.length === 0, "Audit statement should be allowed.");

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    affirmative_claim_blocked: true,
    negated_claim_allowed: true,
    prohibition_allowed: true,
    audit_statement_allowed: true
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
