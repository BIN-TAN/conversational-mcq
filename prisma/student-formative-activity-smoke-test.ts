import { readFile } from "node:fs/promises";
import {
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

async function main() {
  const agentCallsBefore = await prisma.agentCall.count();

  const diagnosticGap = packetFor({
    pattern: "likely_knowledge_gap",
    primary_value: "diagnostic_clarification"
  });
  assert(
    diagnosticGap.activity_family === "basic_concept_grounding",
    "diagnostic_clarification + likely_knowledge_gap should map to basic_concept_grounding."
  );

  const diagnosticMisconception = packetFor({
    pattern: "likely_misconception",
    primary_value: "diagnostic_clarification"
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
    primary_value: "reasoning_refinement"
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
    confidence_summary: "The reasoning evidence is adequate, but the student appears underconfident."
  });
  assert(
    confidenceAudit.activity_family === "confidence_evidence_audit",
    "confidence_calibration + stable understanding should map to confidence_evidence_audit."
  );

  const independentReconstruction = packetFor({
    pattern: "mixed_or_conflicting_evidence",
    primary_value: "independent_understanding_verification",
    reliability_limited: true
  });
  assert(
    independentReconstruction.activity_family === "independent_reconstruction",
    "independent_understanding_verification + mixed/conflicting evidence should map to independent_reconstruction."
  );

  const transfer = packetFor({
    pattern: "stable_understanding",
    primary_value: "consolidation_and_transfer",
    status: "Mostly understood",
    status_confidence: "high"
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

  assertInvalid(
    unsafeFirstTurn(diagnosticGap, "Good job. Can you review the concept?"),
    "generic_feedback_detected",
    "Generic feedback"
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

  console.log(JSON.stringify({
    status: "passed",
    cases_checked: 21,
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
