import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { StudentProfileOutput } from "../src/lib/agents/contracts";
import {
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  canonicalFormativeConversationProfileFromStudentProfile,
  type FormativeConversationCanonicalProfileSource
} from "../src/lib/services/student-assessment/formative-conversation/profile-update";
import {
  FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION,
  validateFormativeConversationProfileTransition
} from "../src/lib/services/student-assessment/formative-conversation/profile-transition-validator";
import { FORMATIVE_CONVERSATION_PROFILE_FIELD_SEMANTICS_VERSION } from "../src/lib/services/student-assessment/formative-conversation/profile-field-semantics";

const transcriptPath =
  ".data/operational-formative-conversation-v5-evaluation-v8/runs/fcv5v8_provider_20260801134821_4d583c17/cases/fcv5_08_mixed_resolved_evidence-transcript.json";
const fixturePath =
  "config/operational-candidates/formative-conversation-host-v5-executable-v8/fixtures/fcv5_08_mixed_resolved_evidence.json";

type SafeV8Transcript = {
  agent_calls: Array<{
    student_visible_tutor_output: string;
    evidence_observations: FormativeConversationAgentOutput["evidence_observations"];
    profile_recommendation: FormativeConversationAgentOutput["profile_transition_recommendation"];
    teacher_assistance_recommendation: FormativeConversationAgentOutput["teacher_assistance_recommendation"];
    lifecycle_recommendation: FormativeConversationAgentOutput["lifecycle_recommendation"];
  }>;
};

function priorProfile() {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const profile = StudentProfileOutput.parse(
    fixture.initial_profile_source.profile
  );
  const source: FormativeConversationCanonicalProfileSource = {
    ability_profile: profile.ability_profile,
    ability_pattern_flags: profile.ability_pattern_flags,
    engagement_profile: profile.engagement_profile,
    engagement_pattern_flags: profile.engagement_pattern_flags,
    integrated_diagnostic_profile:
      profile.integrated_diagnostic_profile,
    integrated_profile_confidence:
      profile.integrated_profile_confidence,
    integrated_profile_rationale:
      profile.integrated_profile_rationale,
    evidence_sufficiency: profile.evidence_sufficiency,
    confidence_alignment: profile.confidence_alignment,
    independence_interpretability:
      profile.independence_interpretability,
    misconception_indicators: profile.misconception_indicators,
    item_level_evidence: profile.item_level_evidence,
    reasoning_quality_summary: profile.reasoning_quality_summary,
    engagement_summary: profile.engagement_summary,
    process_interpretation_cautions:
      profile.process_interpretation_cautions,
    profile_confidence: profile.profile_confidence,
    rationale: profile.rationale,
    recommended_next_evidence: profile.recommended_next_evidence
  };
  return canonicalFormativeConversationProfileFromStudentProfile(source);
}

function exactV8Case8Output() {
  const transcript = JSON.parse(
    readFileSync(transcriptPath, "utf8")
  ) as SafeV8Transcript;
  const call = transcript.agent_calls.at(-1);
  assert(call, "The immutable V8 Case 8 final call is missing.");
  return FormativeConversationAgentOutputSchema.parse({
    contract_version: "formative-conversation-agent-contract-v1",
    student_visible_message: call.student_visible_tutor_output,
    teaching_artifact: null,
    evidence_observations: call.evidence_observations,
    profile_transition_recommendation: call.profile_recommendation,
    teacher_assistance_recommendation:
      call.teacher_assistance_recommendation,
    lifecycle_recommendation: call.lifecycle_recommendation
  });
}

function validate(output: FormativeConversationAgentOutput) {
  return validateFormativeConversationProfileTransition({
    recommendation: output.profile_transition_recommendation,
    prior_profile: priorProfile(),
    evidence_observations: output.evidence_observations,
    available_turns: [
      { sequence_index: 668, actor: "student" },
      { sequence_index: 669, actor: "tutor" }
    ]
  });
}

function main() {
  const exactOutput = exactV8Case8Output();
  const rejected = validate(exactOutput);
  assert.equal(rejected.valid, false);
  if (rejected.valid) {
    throw new Error("v8_case8_semantic_replay_unexpectedly_valid");
  }
  const semanticIssues = rejected.issues.filter(
    (entry) =>
      entry.code ===
      "profile_transition_misconception_field_semantics_invalid"
  );
  assert.equal(semanticIssues.length, 2);
  assert(
    semanticIssues.some((entry) =>
      entry.message.includes("resolved or historical")
    )
  );
  assert(
    semanticIssues.some((entry) =>
      entry.message.includes("limitation, uncertainty, or question")
    )
  );

  const corrected = structuredClone(exactOutput);
  assert(corrected.profile_transition_recommendation?.updated_profile);
  corrected.profile_transition_recommendation.updated_profile.misconception_indicators =
    [];
  const accepted = validate(corrected);
  assert.equal(accepted.valid, true);

  console.log(
    JSON.stringify({
      status: "passed",
      immutable_v8_case8_replay: "rejected_before_persistence",
      precise_semantic_issue_count: semanticIssues.length,
      corrected_field_roles_accepted: true,
      validator_version:
        FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION,
      semantic_contract_version:
        FORMATIVE_CONVERSATION_PROFILE_FIELD_SEMANTICS_VERSION,
      provider_calls: 0,
      model_auth_requests: 0
    })
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message
          : "formative_conversation_v9_profile_semantics_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0
    })
  );
  process.exitCode = 1;
}
