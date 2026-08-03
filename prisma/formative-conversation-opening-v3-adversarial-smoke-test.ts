import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  type FormativeConversationAgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_OPENING_VERSION,
  validateFormativeConversationOpeningDisclosureScope,
  validateFormativeConversationOpeningOutput
} from "../src/lib/services/student-assessment/formative-conversation/opening-contract";

const V12_RUN_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v12/runs/fcv5v12_provider_20260803134449_100f045f";

function output(message: string): FormativeConversationAgentOutput {
  return {
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    student_visible_message: message,
    teaching_artifact: null,
    evidence_observations: [],
    profile_transition_recommendation: null,
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  };
}

const scopeMatrix = [
  {
    category: "diagnosis_scope",
    text: "A scale may be used for diagnosis in some contexts.",
    expected: []
  },
  {
    category: "acknowledgement_paraphrase",
    text: "You already identified two important ideas.",
    expected: []
  },
  {
    category: "measurement_language",
    text: "Observed scores can vary because of measurement error.",
    expected: []
  },
  {
    category: "profile_leakage",
    text: "Your diagnostic profile shows partial understanding.",
    expected: ["opening_exposes_profile_language"]
  },
  {
    category: "score_leakage",
    text: "Your score was 2 out of 3.",
    expected: ["opening_repeats_score"]
  },
  {
    category: "teacher_only_leakage",
    text: "Your teacher noted that you struggle with this concept.",
    expected: ["opening_exposes_teacher_only_information"]
  },
  {
    category: "diagnosis_scope",
    text: "Medical diagnosis is one possible use of a measurement.",
    expected: []
  },
  {
    category: "diagnosis_scope",
    text: "You were diagnosed as having partial understanding.",
    expected: ["opening_exposes_diagnosis_language"]
  },
  {
    category: "profile_leakage",
    text: "The profile indicates that your understanding is partial.",
    expected: ["opening_exposes_profile_language"]
  },
  {
    category: "hidden_reasoning_leakage",
    text: "My internal reasoning says you should revisit reliability.",
    expected: ["opening_exposes_hidden_reasoning"]
  },
  {
    category: "score_scope",
    text: "Suppose a person scores 80 on a test.",
    expected: []
  },
  {
    category: "score_scope",
    text: "For example, if a student scored 2 out of 3, the observed score would still contain error.",
    expected: []
  }
] as const;

const acknowledgementMatrix = [
  "You already identified two important ideas. Let us connect them.",
  "From what you explained, one distinction is worth exploring.",
  "I noticed in your reasoning that consistency matters to you.",
  "Now that you have reviewed your answers, we can examine the main idea.",
  "Looking over your responses, there is a useful connection to make.",
  "Now that you have looked through the results, let us connect the main ideas.",
  "You pointed out an important distinction, so let us build from it."
] as const;

const fullOpeningMatrix = [
  {
    category: "diagnosis_scope",
    message:
      "Looking over your responses, a scale may be used for diagnosis in some contexts. Let us examine what evidence would justify that use.",
    valid: true
  },
  {
    category: "measurement_language",
    message:
      "You already identified two important ideas. Observed scores can vary because of measurement error, so let us connect that uncertainty to interpretation.",
    valid: true
  },
  {
    category: "profile_leakage",
    message:
      "Looking over your responses, your diagnostic profile shows partial understanding. Let us continue.",
    valid: false
  },
  {
    category: "score_leakage",
    message:
      "Looking over your responses, your score was 2 out of 3. Let us continue.",
    valid: false
  },
  {
    category: "teacher_only_leakage",
    message:
      "Looking over your responses, your teacher noted that you struggle with this concept. Let us continue.",
    valid: false
  }
] as const;

function readV12Opening(caseId: string, expectedHash: string) {
  const path = `${V12_RUN_ROOT}/cases/${caseId}-transcript.json`;
  const source = readFileSync(path);
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    expectedHash,
    `Immutable V12 evidence changed: ${caseId}`
  );
  const parsed = JSON.parse(source.toString("utf8")) as {
    agent_calls: Array<{
      safe_invalid_output_evidence: { candidate_text: string } | null;
    }>;
  };
  const message = parsed.agent_calls[0]?.safe_invalid_output_evidence?.candidate_text;
  assert.ok(message, `V12 ${caseId} opening candidate must exist.`);
  return message;
}

function main() {
  for (const fixture of scopeMatrix) {
    assert.deepEqual(
      validateFormativeConversationOpeningDisclosureScope(fixture.text),
      [...fixture.expected],
      fixture.category
    );
  }
  for (const message of acknowledgementMatrix) {
    const validation = validateFormativeConversationOpeningOutput(output(message));
    assert.equal(validation.valid, true, message);
  }
  for (const fixture of fullOpeningMatrix) {
    const validation = validateFormativeConversationOpeningOutput(
      output(fixture.message)
    );
    assert.equal(validation.valid, fixture.valid, fixture.category);
  }

  const v12Case2 = readV12Opening(
    "fcv5_02_first_principles_adaptation",
    "3fb9752dcf041ac55cf627874ddc4f786467b4c7da76843f171e5650f457963d"
  );
  const v12Case3 = readV12Opening(
    "fcv5_03_direct_answer_handling",
    "8999469f3d2a8235154dd089343cb2b9f8d5b99d257268407d28f5d3505f7047"
  );
  assert.equal(validateFormativeConversationOpeningOutput(output(v12Case2)).valid, true);
  assert.equal(validateFormativeConversationOpeningOutput(output(v12Case3)).valid, true);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        opening_validator_version: FORMATIVE_CONVERSATION_OPENING_VERSION,
        exact_scope_fixtures: scopeMatrix.length,
        acknowledgement_paraphrases: acknowledgementMatrix.length,
        complete_opening_fixtures: fullOpeningMatrix.length,
        immutable_v12_failures_replayed: 2,
        provider_calls: 0,
        network_requests: 0
      },
      null,
      2
    )
  );
}

main();
