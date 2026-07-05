import { readFile } from "node:fs/promises";
import {
  buildFormativeActivityDesignPacketForSession,
  buildFormativeActivityDesignPacketFromPackets,
  validateFormativeActivityPacket,
  writeRedactedFormativeActivityReviewArtifact,
  type FormativeActivityPacketV1
} from "../src/lib/services/student-assessment/formative-activity-design";
import { prisma } from "../src/lib/db";
import { buildSyntheticActivitySourcePackets } from "./student-formative-activity-fixtures";
import { assert } from "./student-mvp-smoke-helpers";

function packetFor(input: Parameters<typeof buildSyntheticActivitySourcePackets>[0]) {
  const source = buildSyntheticActivitySourcePackets(input);
  const packet = buildFormativeActivityDesignPacketFromPackets({
    profile_integration_packet: source.profile,
    formative_value_packet: source.formative
  });
  const validation = validateFormativeActivityPacket(packet);
  assert(validation.valid, `Activity packet should validate: ${JSON.stringify(validation.issues)}`);
  return packet;
}

function packetWithPreference(
  input: Parameters<typeof buildSyntheticActivitySourcePackets>[0],
  preferredActivityFamily: "independent_reconstruction"
) {
  const source = buildSyntheticActivitySourcePackets(input);
  const packet = buildFormativeActivityDesignPacketFromPackets({
    profile_integration_packet: source.profile,
    formative_value_packet: source.formative,
    student_preference: {
      choice: "chose_alternative",
      preferred_activity_family: preferredActivityFamily
    }
  });
  const validation = validateFormativeActivityPacket(packet);
  assert(validation.valid, `Preference activity packet should validate: ${JSON.stringify(validation.issues)}`);
  return packet;
}

function clonePacket(packet: FormativeActivityPacketV1): FormativeActivityPacketV1 {
  return structuredClone(packet);
}

function assertInvalid(
  packet: FormativeActivityPacketV1,
  expectedRule: string,
  message: string
) {
  const validation = validateFormativeActivityPacket(packet);
  assert(!validation.valid, `${message}: packet should be invalid.`);
  assert(
    validation.issues.some((issue) => issue.rule_code === expectedRule),
    `${message}: expected ${expectedRule}, got ${JSON.stringify(validation.issues)}`
  );
}

function unsafeFirstTurn(base: FormativeActivityPacketV1, message: string) {
  const packet = clonePacket(base);
  packet.first_turn.message = message;
  return packet;
}

function assertIncludes(text: string, pattern: RegExp, message: string) {
  assert(pattern.test(text), message);
}

function assertExcludes(text: string, pattern: RegExp, message: string) {
  assert(!pattern.test(text), message);
}

function assertSafeStudentStatus(packet: FormativeActivityPacketV1) {
  assert(
    ["Mostly understood", "Still developing", "Needs more work"].includes(
      packet.personalization_basis.student_safe_profile_status
    ),
    "Every activity sample should include a student-safe profile status."
  );
}

async function main() {
  const agentCallsBefore = await prisma.agentCall.count();

  const diagnosticGap = packetFor({
    pattern: "likely_knowledge_gap",
    primary_value: "diagnostic_clarification",
    student_message: "Your answers suggest the basic boundary is still forming.",
    ability_summary: "The explanation names theta and item information but does not yet separate their roles."
  });
  assert(
    diagnosticGap.activity_family === "basic_concept_grounding",
    "diagnostic_clarification + likely_knowledge_gap should map to basic_concept_grounding."
  );

  const diagnosticMisconception = packetFor({
    pattern: "likely_misconception",
    primary_value: "diagnostic_clarification",
    student_message: "Your answer pattern suggests a tempting alternative is pulling two ideas together.",
    ability_summary: "The explanation mixes a person's estimated ability with the information provided by the item."
  });
  assert(
    diagnosticMisconception.activity_family === "distractor_contrast",
    "diagnostic_clarification + likely_misconception should map to distractor_contrast."
  );
  assert(
    diagnosticMisconception.distractor_use.distractor_role !== "none",
    "Diagnostic distractor evidence should be represented."
  );

  const reasoningRepair = packetFor({
    pattern: "developing_understanding",
    primary_value: "reasoning_refinement",
    student_message: "Your reasoning has a useful start but needs one clearer connection.",
    ability_summary: "The explanation points toward theta but skips the link to item information."
  });
  assert(
    reasoningRepair.activity_family === "reasoning_chain_repair",
    "reasoning_refinement + developing_understanding should map to reasoning_chain_repair."
  );

  const confidenceAudit = packetFor({
    pattern: "stable_understanding",
    primary_value: "confidence_calibration",
    status: "Mostly understood",
    status_confidence: "high",
    student_message: "Your explanation has enough substance to check confidence against evidence.",
    ability_summary: "The explanation separates the person-side estimate from the item-side information.",
    confidence_summary: "You were cautious even though the explanation gives usable evidence."
  });
  assert(
    confidenceAudit.activity_family === "confidence_evidence_audit",
    "confidence_calibration + stable understanding should map to confidence_evidence_audit."
  );

  const independentReconstruction = packetFor({
    pattern: "mixed_or_conflicting_evidence",
    primary_value: "independent_understanding_verification",
    reliability_limited: true,
    student_message: "Your answers leave the explanation unclear enough that an own-words rebuild is useful.",
    ability_summary: "The responses vary between option recognition and a partial concept explanation."
  });
  assert(
    independentReconstruction.activity_family === "independent_reconstruction",
    "independent_understanding_verification + mixed/conflicting evidence should map to independent_reconstruction."
  );

  const transfer = packetFor({
    pattern: "stable_understanding",
    primary_value: "consolidation_and_transfer",
    status: "Mostly understood",
    status_confidence: "high",
    student_message: "Your answers give a stable base for extending the concept.",
    ability_summary: "The explanation keeps the person-side estimate separate from item information."
  });
  assert(
    transfer.activity_family === "transfer_and_distractor_generation",
    "consolidation_and_transfer + stable understanding should map to transfer_and_distractor_generation."
  );
  assert(
    transfer.distractor_use.distractor_role === "generated_distractor",
    "Transfer family should permit unscored distractor generation as an evidence action."
  );

  const reliabilityLimited = packetFor({
    pattern: "mixed_or_conflicting_evidence",
    primary_value: "independent_understanding_verification",
    reliability_limited: true,
    ai_assistance_context: true
  });
  assert(
    reliabilityLimited.activity_family === "independent_reconstruction",
    "Reliability-limited evidence should use independent reconstruction in no-live design."
  );

  const selectedDiagnosticDistractor = packetFor({
    pattern: "likely_misconception",
    primary_value: "reasoning_refinement"
  });
  assert(
    selectedDiagnosticDistractor.activity_family === "distractor_contrast",
    "Selected diagnostic distractor evidence should map to distractor contrast."
  );

  const temptingDistractor = packetFor({
    pattern: "likely_misconception",
    primary_value: "diagnostic_clarification"
  });
  assert(
    temptingDistractor.distractor_use.distractor_role === "tempting_distractor",
    "Tempting distractor evidence should be represented as a tempting distractor."
  );

  const override = packetWithPreference({
    pattern: "likely_knowledge_gap",
    primary_value: "diagnostic_clarification"
  }, "independent_reconstruction");
  assert(
    override.activity_family === "independent_reconstruction",
    "Student preference override should select an allowed backup family."
  );

  const moveOn = packetFor({
    pattern: "stable_understanding",
    primary_value: "consolidation_and_transfer",
    selected_value: "move_on",
    student_choice: "moved_on"
  });
  assert(moveOn.student_choice_policy.can_move_on, "Move-on should be represented in policy.");

  assert(
    diagnosticMisconception.first_turn.message.length > 500,
    "First turn should be long and specific enough for a complete explanation."
  );
  assert(
    (diagnosticMisconception.first_turn.message.match(/\?/g) ?? []).length === 1,
    "First turn should end with exactly one prompt."
  );
  assert(
    diagnosticMisconception.evidence_update_plan.requires_student_response_before_update,
    "Profile/formative updates must require a student response first."
  );
  assert(
    diagnosticMisconception.evidence_update_plan.production_update_not_implemented_in_phase_29a,
    "Production update must remain unimplemented in Phase 29a."
  );

  assertIncludes(
    diagnosticGap.first_turn.message,
    /\bbasic distinction\b/i,
    "basic_concept_grounding should start from a concrete basic distinction."
  );
  assertIncludes(
    diagnosticGap.first_turn.message,
    /\bperson's estimated ability\b[\s\S]{0,180}\bitem\b/i,
    "basic_concept_grounding should explain person ability versus item information."
  );
  assertIncludes(
    diagnosticMisconception.first_turn.message,
    /\bhidden assumption\b[\s\S]{0,180}\b(interchangeable|swapped|separate)\b/i,
    "distractor_contrast should name a hidden assumption and contrast."
  );
  assertIncludes(
    reasoningRepair.first_turn.message,
    /\buseful starting point\b[\s\S]{0,180}\bmissing link\b/i,
    "reasoning_chain_repair should mention useful part and missing link."
  );
  assertIncludes(
    independentReconstruction.first_turn.message,
    /\boption choices aside\b[\s\S]{0,220}\bin your own words\b/i,
    "independent_reconstruction should set options aside and ask for own words."
  );
  assertExcludes(
    independentReconstruction.first_turn.message,
    /\b(ai|external assistance)\b/i,
    "independent_reconstruction student text must not mention AI or external assistance."
  );
  assertIncludes(
    confidenceAudit.first_turn.message,
    /\busable understanding\b[\s\S]{0,220}\bconfidence\b/i,
    "confidence_evidence_audit should connect adequate evidence to confidence."
  );
  assertExcludes(
    confidenceAudit.first_turn.message,
    /\bthe student appears\b/i,
    "confidence_evidence_audit should not use impersonal student-reference language."
  );
  assertIncludes(
    transfer.first_turn.message,
    /\bnot another scored question\b/i,
    "transfer_and_distractor_generation should say it is not another scored question."
  );
  for (const packet of [
    diagnosticGap,
    diagnosticMisconception,
    reasoningRepair,
    independentReconstruction,
    confidenceAudit,
    transfer
  ]) {
    assertSafeStudentStatus(packet);
  }
  assert(
    new Set([
      diagnosticGap.first_turn.message,
      diagnosticMisconception.first_turn.message,
      reasoningRepair.first_turn.message,
      independentReconstruction.first_turn.message,
      confidenceAudit.first_turn.message,
      transfer.first_turn.message
    ]).size === 6,
    "Every family should have distinct first-turn wording."
  );

  assertInvalid(
    unsafeFirstTurn(diagnosticGap, "Good job. Can you review the concept?"),
    "generic_feedback",
    "Generic feedback"
  );
  assertInvalid(
    unsafeFirstTurn(
      diagnosticGap,
      "In your earlier responses, Your responses show a pattern. The current reasoning summary is that The current evidence is mixed. Can you continue?"
    ),
    "template_splice_artifact",
    "Template splice artifact"
  );
  assertInvalid(
    unsafeFirstTurn(
      diagnosticGap,
      "Current ability evidence is interpreted as packet confidence from profile integration. Can you continue?"
    ),
    "internal_evidence_label_exposed",
    "Internal evidence labels"
  );
  assertInvalid(
    unsafeFirstTurn(diagnosticGap, "The student appears ready to continue. Can you continue?"),
    "impersonal_student_reference",
    "Impersonal student reference"
  );
  assertInvalid(
    unsafeFirstTurn(diagnosticGap, "The key idea is Focus on explaining the key distinction in your own words. Can you continue?"),
    "broken_concept_focus",
    "Broken concept focus"
  );
  assertInvalid(
    unsafeFirstTurn(diagnosticGap, "The answer key says A is correct. Can you continue?"),
    "answer_key_leak_detected",
    "Answer key leakage"
  );
  assertInvalid(
    unsafeFirstTurn(diagnosticGap, "The correct option is A. Can you continue?"),
    "correct_option_leak_detected",
    "Correct option leakage"
  );
  assertInvalid(
    unsafeFirstTurn(diagnosticGap, "This distractor metadata shows misconception_id M1. Can you compare?"),
    "distractor_metadata_detected",
    "Raw distractor metadata leakage"
  );
  assertInvalid(
    unsafeFirstTurn(diagnosticGap, "The engagement category and AI assistance signal explain this. Can you continue?"),
    "engagement_or_ai_label_exposed",
    "Engagement or AI label leakage"
  );
  assertInvalid(
    unsafeFirstTurn(diagnosticGap, "This raises an integrity concern. Can you continue?"),
    "unsupported_integrity_language_detected",
    "Integrity language"
  );
  assertInvalid(
    unsafeFirstTurn(diagnosticGap, "Now I will create a new scored item for you. Can you continue?"),
    "new_scored_item_generated",
    "New scored item generation"
  );
  assertInvalid(
    unsafeFirstTurn(diagnosticMisconception, "A tempting option can feel reasonable because it has a surface clue. Can you continue?"),
    "fake_distractor_contrast",
    "Fake distractor contrast"
  );

  const missingDistractorRole = clonePacket(diagnosticMisconception);
  missingDistractorRole.distractor_use.distractor_role = "none";
  assertInvalid(
    missingDistractorRole,
    "fake_distractor_contrast",
    "distractor_contrast family without distractor role"
  );

  const missingStudentGate = clonePacket(diagnosticGap) as unknown as Record<string, unknown>;
  missingStudentGate.evidence_update_plan = {
    ...(diagnosticGap.evidence_update_plan as Record<string, unknown>),
    requires_student_response_before_update: false
  };
  assert(
    !validateFormativeActivityPacket(missingStudentGate).valid,
    "Missing student-response gate should be rejected."
  );

  const artifactPath = await writeRedactedFormativeActivityReviewArtifact({ packet: diagnosticMisconception });
  const artifact = await readFile(artifactPath, "utf8");
  const forbiddenArtifactTerms = [
    "api key",
    "authorization header",
    "answer key",
    "correct option",
    "misconception_id",
    "raw process payload",
    "raw llm output"
  ];
  for (const term of forbiddenArtifactTerms) {
    assert(!artifact.toLowerCase().includes(term), `Redacted activity artifact leaked ${term}.`);
  }

  const agentCallsAfter = await prisma.agentCall.count();
  assert(agentCallsAfter === agentCallsBefore, "No agent_calls rows should be created by no-live activity design.");

  const realSession = await buildFormativeActivityDesignPacketForSession("sess_20260701_v2n-8a0");
  const realValidation = validateFormativeActivityPacket(realSession);
  assert(realValidation.valid, `Real session activity packet should validate: ${JSON.stringify(realValidation.issues)}`);
  assertExcludes(
    realSession.first_turn.message,
    /\b(ability evidence|ability[- ]packet|packet confidence|profile integration|formative value|engagement category|ai assistance|process data)\b/i,
    "sess_20260701_v2n-8a0 first turn should not expose internal labels."
  );

  console.log(JSON.stringify({
    status: "passed",
    cases_checked: 37,
    example_activity_family: diagnosticMisconception.activity_family,
    redacted_activity_artifact_path: artifactPath,
    openai_calls_made: false,
    agent_call_delta: agentCallsAfter - agentCallsBefore
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
