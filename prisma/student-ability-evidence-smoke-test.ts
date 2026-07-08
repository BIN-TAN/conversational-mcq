import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  AbilityEvidencePacketV1Schema,
  buildAbilityEvidencePacketForSession,
  buildItemAbilityEvidence,
  diagnosticMetadataForItem,
  projectStudentSafeAbilityStatus,
  summarizeConceptAbilityEvidence
} from "../src/lib/services/student-assessment/ability-evidence";
import { createResponsePackage } from "../src/lib/services/response-packages";
import {
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  assert,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();

function assertStudentSafeProjectionIsSafe(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "answer key",
    "correct option",
    "correct_option",
    "correctness",
    "distractor",
    "misconception",
    "raw reasoning",
    "evidence trace",
    "student response"
  ];

  for (const term of forbidden) {
    assert(!serialized.includes(term), `Student-safe projection leaked ${term}.`);
  }
}

const baseMetadata = diagnosticMetadataForItem({
  item_public_id: "ability_smoke_item",
  concept_id: "theta_invariance",
  options: [
    { label: "A", text: "Item difficulty determines person ability." },
    { label: "B", text: "Theta changes because the test form is harder." },
    { label: "C", text: "Theta is the person location on a linked latent trait scale." },
    { label: "D", text: "Discrimination changes the meaning of theta." }
  ],
  correct_option: "C",
  distractor_rationales: {
    A: "Confuses item difficulty with person ability.",
    B: "Claims theta changes because the form is harder.",
    C: "Correct answer.",
    D: "Claims discrimination changes the meaning of theta."
  },
  expected_reasoning_patterns: [
    "Theta is the person ability location on the latent trait scale.",
    "Item difficulty and discrimination describe item behavior rather than person ability."
  ],
  possible_misconception_indicators: [
    "Confuses item difficulty with person ability.",
    "Claims theta changes because the form is harder."
  ],
  administration_rules: {
    concept_id: "theta_invariance",
    cognitive_level: "understand",
    subskills: [
      "distinguish_person_ability_from_item_difficulty",
      "interpret_theta_on_linked_scale"
    ],
    difficulty_label: "medium",
    discrimination_label: "unknown"
  }
});

type EvidenceInput = Omit<Parameters<typeof buildItemAbilityEvidence>[0], "item_public_id" | "metadata">;

function evidence(input: EvidenceInput) {
  return buildItemAbilityEvidence({
    item_public_id: "ability_smoke_item",
    metadata: baseMetadata,
    total_item_time_ms: 45000,
    ...input
  });
}

function runPureEvidenceAssertions() {
  const strong = evidence({
    selected_option: "C",
    correctness: "correct",
    confidence: "High",
    reasoning_text:
      "Theta is the person's location on the latent trait scale, while item difficulty and discrimination describe item behavior rather than person ability.",
    no_tempting_option: true
  });
  assert(strong.ability_signal_category === "strong_understanding", "Correct detailed reasoning should be strong understanding.");
  assert(strong.unsupported_correct_response === false, "Correct detailed reasoning should not be marked unsupported.");
  assert(strong.correctness_support_level === "supported_by_reasoning", "Correct detailed reasoning should be supported by reasoning.");
  assert(strong.answer_selection_evidence_weight === "high", "Correct detailed reasoning should have high answer-selection evidence weight.");

  const shallow = evidence({
    selected_option: "C",
    correctness: "correct",
    confidence: "High",
    reasoning_text: "Because it seems right.",
    no_tempting_option: true
  });
  assert(shallow.ability_signal_category === "shallow_or_guess", "Correct vague high-confidence reasoning should not be strong.");
  assert(shallow.unsupported_correct_response, "Correct vague reasoning should be flagged as unsupported correctness.");
  assert(shallow.correctness_support_level === "unsupported", "Correct vague reasoning should have unsupported support level.");
  assert(
    shallow.estimated_guessing_risk === "medium" || shallow.estimated_guessing_risk === "high",
    "Correct vague reasoning should carry medium/high uncertainty risk."
  );

  const misconception = evidence({
    selected_option: "A",
    correctness: "incorrect",
    confidence: "High",
    reasoning_text: "Item difficulty directly determines person ability, so a harder form lowers theta.",
    no_tempting_option: true
  });
  assert(misconception.ability_signal_category === "misconception_signal", "Aligned diagnostic distractor should be a misconception signal.");

  const lowConfidenceWrong = evidence({
    selected_option: "A",
    correctness: "incorrect",
    confidence: "Low",
    reasoning_text: "I don't know the reason yet.",
    no_tempting_option: true
  });
  assert(
    ["knowledge_gap", "ambiguous_mixed_evidence"].includes(lowConfidenceWrong.ability_signal_category),
    "Low-confidence wrong evidence should not force a stable misconception."
  );

  const doNotKnow = evidence({
    selected_option: "E",
    correctness: "not_scored",
    confidence: "Low",
    reasoning_text: "I don't know the reason yet.",
    no_tempting_option: true
  });
  assert(doNotKnow.ability_signal_category === "knowledge_gap", "E with low confidence should be a knowledge gap.");

  const underconfident = evidence({
    selected_option: "C",
    correctness: "correct",
    confidence: "Low",
    reasoning_text:
      "Theta is the person's location on the latent trait scale, while item difficulty describes item behavior.",
    no_tempting_option: true
  });
  assert(
    underconfident.ability_signal_category === "knowledge_gap" ||
      underconfident.ability_signal_category === "emerging_understanding",
    "Correct low-confidence evidence should not be strong without stronger support."
  );
  assert(underconfident.confidence_calibration_signal === "underconfident", "Correct low-confidence evidence should be underconfident.");
  assert(underconfident.unsupported_correct_response, "Correct low-confidence evidence should be marked as unsupported correctness.");
  assert(
    underconfident.estimated_guessing_risk_basis.includes("low_confidence"),
    "Low confidence should be recorded as a safe uncertainty-risk basis."
  );

  const temptingRisk = evidence({
    selected_option: "C",
    correctness: "correct",
    confidence: "High",
    reasoning_text:
      "Theta is the person location on the latent trait scale, and item difficulty describes item behavior.",
    tempting_option: "A",
    tempting_option_reason: "The item difficulty wording was tempting."
  });
  assert(temptingRisk.ability_signal_category === "emerging_understanding", "Diagnostic tempting option should mark fragile evidence.");
  assert(temptingRisk.tempting_misconception_ids.length > 0, "Diagnostic tempting option should record misconception risk.");

  const partialAccess = evidence({
    selected_option: "A",
    correctness: "incorrect",
    confidence: "Medium",
    reasoning_text:
      "Theta is the person ability location on the latent trait scale, and I mixed up how item difficulty fits.",
    tempting_option: "C",
    tempting_option_reason: "The linked scale language sounded right."
  });
  assert(partialAccess.ability_signal_category === "emerging_understanding", "Correct tempting option with partial reasoning should be emerging.");

  const conflicting = evidence({
    selected_option: "A",
    correctness: "incorrect",
    confidence: "Medium",
    reasoning_text:
      "Theta is the person's latent trait scale location, and item difficulty describes item behavior rather than person ability.",
    no_tempting_option: true
  });
  assert(
    ["ambiguous_mixed_evidence", "insufficient_evidence"].includes(conflicting.ability_signal_category),
    "Conflicting evidence should remain ambiguous or insufficient."
  );

  const missingCalibrationMetadata = diagnosticMetadataForItem({
    item_public_id: "ability_missing_calibration",
    concept_id: "theta_invariance",
    options: [
      { label: "A", text: "Wrong." },
      { label: "B", text: "Wrong." },
      { label: "C", text: "Right." },
      { label: "D", text: "Wrong." }
    ],
    correct_option: "C"
  });
  const missingCalibration = buildItemAbilityEvidence({
    item_public_id: "ability_missing_calibration",
    metadata: missingCalibrationMetadata,
    selected_option: "C",
    correctness: "correct",
    confidence: "High",
    reasoning_text: "Theta is a person ability estimate.",
    no_tempting_option: true
  });
  assert(
    missingCalibration.optional_future_calibration.difficulty_label === "unknown",
    "Missing difficulty should not block evidence generation."
  );
  assert(
    missingCalibration.evidence_limitations.includes("difficulty_label_missing_or_unknown_optional_only"),
    "Missing optional difficulty should be documented as a limitation."
  );

  const calibratedMetadata = diagnosticMetadataForItem({
    item_public_id: "ability_calibration_labels",
    concept_id: "theta_invariance",
    options: [
      { label: "A", text: "Wrong." },
      { label: "B", text: "Wrong." },
      { label: "C", text: "Right." },
      { label: "D", text: "Wrong." }
    ],
    correct_option: "C",
    administration_rules: {
      difficulty_label: "hard",
      discrimination_label: "high",
      empirical_ctt_item_difficulty: 0.62,
      empirical_ctt_discrimination: 0.31,
      calibration_sample_notes: "synthetic smoke labels only"
    }
  });
  assert(calibratedMetadata.optional_future_calibration.difficulty_label === "hard", "Difficulty label should be preserved.");
  assert(calibratedMetadata.optional_future_calibration.discrimination_label === "high", "Discrimination label should be preserved.");

  const normalPace = evidence({
    selected_option: "C",
    correctness: "correct",
    confidence: "High",
    reasoning_text:
      "Theta is the person's location on the latent trait scale, while item difficulty describes item behavior.",
    no_tempting_option: true,
    total_item_time_ms: 45000
  });
  const rapidPace = evidence({
    selected_option: "C",
    correctness: "correct",
    confidence: "High",
    reasoning_text:
      "Theta is the person's location on the latent trait scale, while item difficulty describes item behavior.",
    no_tempting_option: true,
    total_item_time_ms: 1000
  });
  assert(normalPace.ability_signal_category === rapidPace.ability_signal_category, "Process data must not directly change ability category.");
  assert(rapidPace.evidence_confidence_modifier.effect === "lower_confidence", "Rapid response should lower inference confidence only.");

  const mixedSummary = summarizeConceptAbilityEvidence([strong, shallow, temptingRisk]);
  assert(
    mixedSummary.provisional_category !== "Mostly understood",
    "A package with unsupported correct evidence should not summarize as Mostly understood."
  );
  assert(
    mixedSummary.unsupported_correct_response_count >= 1,
    "Concept summary should count unsupported correct responses."
  );
  assert(
    mixedSummary.estimated_guessing_risk_counts.high >= 1 ||
      mixedSummary.estimated_guessing_risk_counts.medium >= 1,
    "Concept summary should count medium/high uncertainty-risk bands."
  );
  const supportedSummary = summarizeConceptAbilityEvidence([strong, strong, strong]);
  const projection = projectStudentSafeAbilityStatus(supportedSummary);
  assertStudentSafeProjectionIsSafe(projection);
  assert(
    supportedSummary.provisional_category === "Mostly understood",
    "Multiple supported strong items should summarize as Mostly understood."
  );
  assert(
    supportedSummary.correctness_support_level_counts.supported_by_reasoning >= 2,
    "Concept summary should count reasoning-supported answers."
  );
  assert(mixedSummary.evidence_limitations.length > 0, "Concept summary should carry item-level evidence limitations.");
}

async function runResponsePackagePacketAssertion() {
  await ensureDemoStudentAssessment(prisma);

  const prefix = `ability_evidence_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];

  try {
    const started = await startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: demoAssessmentPublicId
    });
    sessionPublicIds.push(started.session.session_public_id);

    let state = await startConceptUnitInitialAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
    });

    for (const itemIndex of [1, 2, 3]) {
      state = await completeInitialItem({
        studentDbId: student.id,
        sessionPublicId: started.session.session_public_id,
        prefix,
        state,
        itemIndex,
        withTemptingReason: itemIndex === 2
      });
    }
    assert(state.assessment_state === "PACKAGE_REVIEW", "Three initial items should reach package review.");

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session_db_id: session.id },
      select: { id: true }
    });
    await createResponsePackage({ concept_unit_session_db_id: conceptUnitSession.id });

    const packet = await buildAbilityEvidencePacketForSession(started.session.session_public_id);
    const parsed = AbilityEvidencePacketV1Schema.parse(packet);

    assert(parsed.item_evidence.length === 3, "Ability packet should include exactly the three initial responses.");
    assert(parsed.source_response_package_ids.length === 1, "Ability packet should trace its source response package.");
    assert(
      parsed.item_evidence.every((item) => item.optional_future_calibration.difficulty_label),
      "Ability packet should preserve optional difficulty labels when available."
    );
    assert(
      parsed.item_evidence.every((item) => item.optional_future_calibration.empirical_ctt_item_difficulty === null),
      "Fixed MVP packet should not require empirical item difficulty."
    );
    assert(
      parsed.concept_level_summary.evidence_limitations.some((limitation) =>
        limitation.includes("discrimination_label_missing_or_unknown_optional_only")
      ),
      "Packet should document missing optional discrimination calibration."
    );
    assertStudentSafeProjectionIsSafe(parsed.student_safe_projection);
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
  }
}

async function main() {
  runPureEvidenceAssertions();
  await runResponsePackagePacketAssertion();
  console.log("Student ability-evidence smoke passed. No OpenAI calls are made by this script.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
