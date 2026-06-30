import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  buildAbilityEvidencePacketForSession,
  buildItemAbilityEvidence,
  diagnosticMetadataForItem
} from "../src/lib/services/student-assessment/ability-evidence";
import {
  auditItemDiagnosticMetadata,
  auditCurrentItemDiagnosticMetadata,
  redactAbilityEvidencePacketForReview,
  type ItemDiagnosticMetadataReviewArtifact,
  type RedactedAbilityEvidenceReviewArtifact,
  validateRedactedAbilityReviewArtifactSafety
} from "../src/lib/services/student-assessment/ability-evidence-review";
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

function configureNoLiveReviewRuntime() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";
}

function getArg(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1] ?? null;

  return null;
}

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeJsonArtifact(fileName: string, payload: unknown) {
  const outputDir = path.join(process.cwd(), ".data", "ability-evidence-review");
  const outputPath = path.join(outputDir, fileName);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return outputPath;
}

async function createSampleSession() {
  configureNoLiveReviewRuntime();
  await ensureDemoStudentAssessment(prisma);

  const prefix = `ability_review_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];
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

  assert(state.assessment_state === "PACKAGE_REVIEW", "Sample session did not reach package review.");

  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: started.session.session_public_id },
    select: { id: true }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
    where: { assessment_session_db_id: session.id },
    select: { id: true }
  });

  await createResponsePackage({ concept_unit_session_db_id: conceptUnitSession.id });

  return {
    session_public_id: started.session.session_public_id,
    cleanup: () =>
      cleanupSmokeStudentSessions({
        prisma,
        userDbId: student.id,
        sessionPublicIds
      })
  };
}

function uniqueLimitations(metadataReview: Awaited<ReturnType<typeof auditCurrentItemDiagnosticMetadata>>) {
  return [...new Set(metadataReview.items.flatMap((item) => item.limitations))].sort();
}

function runReviewAssertions(input: {
  metadataReview: ItemDiagnosticMetadataReviewArtifact;
  redactedArtifact: RedactedAbilityEvidenceReviewArtifact;
}) {
  assert(input.metadataReview.item_count > 0, "Metadata review should include current items.");
  assert(
    input.metadataReview.items.length === input.metadataReview.item_count,
    "Metadata review item count does not match item rows."
  );
  assert(
    input.redactedArtifact.item_evidence.length === input.redactedArtifact.item_count,
    "Redacted ability artifact item count does not match item evidence."
  );
  assert(
    ["Mostly understood", "Still developing", "Needs more work"].includes(
      input.redactedArtifact.student_safe_projection.status
    ),
    "Student-safe projection used an unsupported status."
  );

  const missingSubskillsAudit = auditItemDiagnosticMetadata({
    item_public_id: "synthetic_missing_subskills",
    concept_unit_public_id: "synthetic_concept",
    options: [
      { label: "A", text: "Wrong." },
      { label: "B", text: "Wrong." },
      { label: "C", text: "Right." },
      { label: "D", text: "Wrong." }
    ],
    correct_option: "C",
    distractor_rationales: {
      A: "Diagnostic note.",
      B: "Diagnostic note.",
      D: "Diagnostic note."
    },
    expected_reasoning_patterns: ["Expected action."],
    administration_rules: {
      cognitive_level: "understand"
    }
  });
  assert(
    missingSubskillsAudit.metadata_status === "usable_with_limitations",
    "Missing subskills should limit metadata without making it insufficient."
  );
  assert(
    missingSubskillsAudit.limitations.includes("subskills_missing"),
    "Missing subskills should be reported as a limitation."
  );
  assert(
    missingSubskillsAudit.limitations.includes("numeric_difficulty_missing_optional_future_calibration"),
    "Missing numeric difficulty should be reported as optional future calibration."
  );

  const missingDistractorAudit = auditItemDiagnosticMetadata({
    item_public_id: "synthetic_missing_distractors",
    concept_unit_public_id: "synthetic_concept",
    options: [
      { label: "A", text: "Wrong." },
      { label: "B", text: "Wrong." },
      { label: "C", text: "Right." },
      { label: "D", text: "Wrong." }
    ],
    correct_option: "C",
    distractor_rationales: {},
    expected_reasoning_patterns: ["Expected action."],
    administration_rules: {
      cognitive_level: "understand",
      subskills: ["synthetic_subskill"]
    }
  });
  assert(
    missingDistractorAudit.limitations.includes("some_options_lack_diagnostic_mapping_or_explicit_role"),
    "Missing distractor mapping should be reported as a limitation."
  );

  const conflictingMetadata = diagnosticMetadataForItem({
    item_public_id: "synthetic_conflicting_item",
    concept_id: "theta_invariance",
    options: [
      { label: "A", text: "Item difficulty determines ability." },
      { label: "B", text: "Wrong." },
      { label: "C", text: "Theta is person ability location." },
      { label: "D", text: "Wrong." }
    ],
    correct_option: "C",
    distractor_rationales: {
      A: "Confuses item difficulty with person ability.",
      B: "Diagnostic note.",
      D: "Diagnostic note."
    },
    expected_reasoning_patterns: [
      "Theta is the person ability location on the latent trait scale.",
      "Item difficulty describes item behavior rather than person ability."
    ],
    administration_rules: {
      cognitive_level: "understand",
      subskills: ["synthetic_subskill"]
    }
  });
  const conflictingEvidence = buildItemAbilityEvidence({
    item_public_id: "synthetic_conflicting_item",
    metadata: conflictingMetadata,
    selected_option: "A",
    correctness: "incorrect",
    confidence: "Medium",
    reasoning_text:
      "Theta is the person ability location on the latent trait scale, and item difficulty describes item behavior rather than person ability.",
    no_tempting_option: true,
    total_item_time_ms: 30000
  });
  assert(
    conflictingEvidence.ability_signal_category !== "strong_understanding",
    "Conflicting evidence must not be forced into strong understanding."
  );
}

async function main() {
  const requestedSessionPublicId = getArg("session-public-id");
  const metadataReview = await auditCurrentItemDiagnosticMetadata();
  const sample = requestedSessionPublicId ? null : await createSampleSession();
  const sessionPublicId = requestedSessionPublicId ?? sample?.session_public_id;

  assert(sessionPublicId, "A session public ID could not be determined.");

  try {
    const packet = await buildAbilityEvidencePacketForSession(sessionPublicId);
    const redactedAbilityArtifact = redactAbilityEvidencePacketForReview(packet);
    const safety = validateRedactedAbilityReviewArtifactSafety(redactedAbilityArtifact);

    if (!safety.passed) {
      throw new Error(`Ability evidence review safety check failed: ${safety.issues.join(", ")}`);
    }

    runReviewAssertions({
      metadataReview,
      redactedArtifact: redactedAbilityArtifact
    });

    const timestamp = fileTimestamp();
    const abilityArtifactPath = await writeJsonArtifact(
      `ability-evidence-review-${timestamp}.json`,
      redactedAbilityArtifact
    );
    const metadataArtifactPath = await writeJsonArtifact(
      `item-diagnostic-metadata-review-${timestamp}.json`,
      metadataReview
    );
    const packetLimitations = [
      ...new Set([
        ...packet.concept_level_summary.evidence_limitations,
        ...packet.item_evidence.flatMap((item) => item.evidence_limitations)
      ])
    ].sort();
    const limitations = [...new Set([...uniqueLimitations(metadataReview), ...packetLimitations])].sort();
    const completedWithLimitations =
      metadataReview.usable_with_limitations_count > 0 ||
      metadataReview.insufficient_count > 0 ||
      packetLimitations.length > 0;

    const summary = {
      status: completedWithLimitations ? "completed_with_limitations" : "passed",
      metadata_item_count: metadataReview.item_count,
      metadata_complete_count: metadataReview.complete_count,
      metadata_usable_with_limitations_count: metadataReview.usable_with_limitations_count,
      metadata_insufficient_count: metadataReview.insufficient_count,
      ability_packet_generated: true,
      item_evidence_count: packet.item_evidence.length,
      concept_provisional_category: packet.concept_level_summary.provisional_category,
      concept_category_confidence: packet.concept_level_summary.category_confidence,
      student_safe_projection_status: packet.student_safe_projection.status,
      redacted_ability_artifact_path: abilityArtifactPath,
      metadata_review_artifact_path: metadataArtifactPath,
      safety_check_passed: safety.passed,
      limitations
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (sample) {
      await sample.cleanup();
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
