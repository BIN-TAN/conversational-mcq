import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  buildEngagementEvidencePacketForSession,
  redactEngagementEvidencePacketForReview,
  validateRedactedEngagementReviewArtifactSafety
} from "../src/lib/services/student-assessment/engagement-evidence";
import { applyProvisionalItemDiagnosticMetadata } from "../src/lib/services/student-assessment/provisional-item-diagnostic-metadata";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { logProcessEvent } from "../src/lib/services/process-events";
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
  const outputDir = path.join(process.cwd(), ".data", "engagement-evidence-review");
  const outputPath = path.join(outputDir, fileName);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return outputPath;
}

function topDecisionReasons(packet: Awaited<ReturnType<typeof buildEngagementEvidencePacketForSession>>) {
  const sessionRules = packet.session_engagement_summary.session_decision_trace.matched_session_rules
    .map((rule) => rule.rule_id);
  const dominantSignals = Object.entries(
    packet.session_engagement_summary.session_decision_trace.dominant_signal_counts
  )
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([key]) => key);

  return [...new Set([...sessionRules, ...dominantSignals])].slice(0, 5);
}

async function addSyntheticProcessContext(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: sessionPublicId },
    select: { id: true }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
    where: { assessment_session_db_id: session.id },
    select: { id: true }
  });
  const responses = await prisma.itemResponse.findMany({
    where: { concept_unit_session_db_id: conceptUnitSession.id },
    orderBy: [{ item: { item_order: "asc" } }],
    select: {
      item_db_id: true,
      item: { select: { item_public_id: true } }
    }
  });
  const first = responses[0];
  const second = responses[1];

  if (first) {
    await logProcessEvent({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: first.item_db_id,
      event_type: "typing_activity_summary",
      event_category: "student_process",
      event_source: "frontend",
      payload: {
        key_count: 84,
        backspace_count: 6,
        enter_key_count: 1,
        duration_ms: 45_000
      }
    });
  }

  if (second) {
    await logProcessEvent({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: second.item_db_id,
      event_type: "paste_detected",
      event_category: "student_process",
      event_source: "frontend",
      payload: {
        target_kind: "textarea",
        pasted_text_length_band: "21_100",
        clipboard_type_count: 1,
        includes_plain_text: true
      }
    });
    await logProcessEvent({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: second.item_db_id,
      event_type: "window_blur",
      event_category: "student_process",
      event_source: "frontend",
      payload: { focus_duration_ms: 12_000 }
    });
  }
}

async function createSampleSession() {
  configureNoLiveReviewRuntime();
  await ensureDemoStudentAssessment(prisma);
  await applyProvisionalItemDiagnosticMetadata(prisma);

  const prefix = `engagement_review_${Date.now()}_${randomUUID().slice(0, 8)}`;
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
  await addSyntheticProcessContext(started.session.session_public_id);

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

async function main() {
  configureNoLiveReviewRuntime();
  await ensureDemoStudentAssessment(prisma);
  await applyProvisionalItemDiagnosticMetadata(prisma);

  const requestedSessionPublicId = getArg("session-public-id");
  const sample = requestedSessionPublicId ? null : await createSampleSession();
  const sessionPublicId = requestedSessionPublicId ?? sample?.session_public_id;

  assert(sessionPublicId, "A session public ID could not be determined.");

  try {
    const packet = await buildEngagementEvidencePacketForSession(sessionPublicId);
    const reviewArtifact = redactEngagementEvidencePacketForReview(packet);
    const safety = validateRedactedEngagementReviewArtifactSafety(reviewArtifact);

    if (!safety.passed) {
      throw new Error(`Engagement evidence review safety check failed: ${safety.issues.join(", ")}`);
    }

    const timestamp = fileTimestamp();
    const engagementArtifactPath = await writeJsonArtifact(
      `engagement-evidence-review-${timestamp}.json`,
      reviewArtifact
    );
    const inventoryArtifactPath = await writeJsonArtifact(
      `process-data-inventory-review-${timestamp}.json`,
      packet.process_data_inventory
    );
    const summary = {
      status: "completed_with_provisional_limitations",
      engagement_packet_generated: true,
      item_evidence_count: packet.item_engagement_evidence.length,
      provisional_engagement_category:
        packet.session_engagement_summary.provisional_engagement_category,
      category_confidence: packet.session_engagement_summary.category_confidence,
      ai_assistance_signal: packet.session_engagement_summary.ai_assistance_signal,
      top_engagement_decision_reasons: topDecisionReasons(packet),
      top_counterevidence:
        packet.session_engagement_summary.session_decision_trace.top_counterevidence,
      package_duration_band:
        packet.session_engagement_summary.session_decision_trace.package_duration_band,
      package_wall_clock_band:
        packet.session_engagement_summary.session_decision_trace.package_timing.wall_clock_band,
      package_focus_adjusted_task_band:
        packet.session_engagement_summary.session_decision_trace.package_timing
          .focus_adjusted_task_band,
      package_sum_item_focus_adjusted_band:
        packet.session_engagement_summary.session_decision_trace.package_timing
          .sum_item_focus_adjusted_band,
      package_response_production_band:
        packet.session_engagement_summary.session_decision_trace.package_timing
          .response_production_band,
      package_reasoning_typing_band:
        packet.session_engagement_summary.session_decision_trace.package_timing.reasoning_typing_band,
      timing_source_used_for_rapid_rule:
        packet.session_engagement_summary.session_decision_trace.package_timing.timing_source_used_for_rapid_rule,
      package_ultra_rapid_rule_matched:
        packet.session_engagement_summary.session_decision_trace.package_timing.package_ultra_rapid_rule_matched,
      package_extreme_rapid_rule_matched:
        packet.session_engagement_summary.session_decision_trace.package_timing.package_extreme_rapid_rule_matched,
      package_rapid_warning_rule_matched:
        packet.session_engagement_summary.session_decision_trace.package_timing.package_rapid_warning_rule_matched,
      reasoning_typing_very_low_rule_matched:
        packet.session_engagement_summary.session_decision_trace.package_timing
          .reasoning_typing_very_low_rule_matched,
      first_student_action_event_type:
        packet.session_engagement_summary.session_decision_trace.timing_reconstruction
          .first_student_action_event.event_type,
      package_submitted_event_type:
        packet.session_engagement_summary.session_decision_trace.timing_reconstruction
          .package_submitted_event.event_type,
      wall_clock_duration_ms:
        packet.session_engagement_summary.session_decision_trace.timing_reconstruction
          .wall_clock_duration_ms,
      response_production_duration_ms:
        packet.session_engagement_summary.session_decision_trace.timing_reconstruction
          .response_production_duration_ms,
      sum_item_focus_adjusted_duration_ms:
        packet.session_engagement_summary.session_decision_trace.timing_reconstruction
          .sum_item_focus_adjusted_duration_ms,
      focus_adjusted_task_duration_ms:
        packet.session_engagement_summary.session_decision_trace.timing_reconstruction
          .focus_adjusted_task_duration_ms,
      package_reasoning_typing_duration_ms:
        packet.session_engagement_summary.session_decision_trace.timing_reconstruction
          .package_reasoning_typing_duration_ms,
      package_reasoning_input_elapsed_time_ms:
        packet.session_engagement_summary.session_decision_trace.timing_reconstruction
          .package_reasoning_input_elapsed_time_ms,
      per_item_reasoning_typing_bands:
        packet.session_engagement_summary.session_decision_trace.timing_reconstruction
          .typing_timing_reconstruction.map((entry) => ({
            item_public_id: entry.item_public_id,
            field_type: entry.field_type,
            typing_duration_band: entry.typing_duration_band,
            typing_duration_ms: entry.typing_duration_ms,
            typing_event_count: entry.typing_event_count,
            includes_idle_time: entry.includes_idle_time,
            includes_blur_time: entry.includes_blur_time,
            timing_limitations: entry.timing_limitations
          })),
      typing_timing_limitations: [
        ...new Set(
          packet.session_engagement_summary.session_decision_trace.timing_reconstruction
            .typing_timing_reconstruction.flatMap((entry) => entry.timing_limitations)
        )
      ],
      timing_limitations:
        packet.session_engagement_summary.session_decision_trace.timing_reconstruction
          .timing_limitations,
      sparse_item_count:
        packet.session_engagement_summary.session_decision_trace.sparse_item_count,
      substantive_item_count:
        packet.session_engagement_summary.session_decision_trace.substantive_item_count,
      substantive_reasoning_basis_counts:
        packet.session_engagement_summary.session_decision_trace.substantive_reasoning_basis_counts,
      matched_session_rules:
        packet.session_engagement_summary.session_decision_trace.matched_session_rules.map(
          (rule) => rule.rule_id
        ),
      threshold_policy: packet.session_engagement_summary.threshold_policy,
      observed_event_type_count:
        Object.keys(packet.process_data_inventory.observed_event_counts).length,
      unobserved_supported_event_type_count:
        packet.process_data_inventory.missing_or_unobserved_event_types.length,
      redacted_engagement_artifact_path: engagementArtifactPath,
      process_data_inventory_artifact_path: inventoryArtifactPath,
      safety_check_passed: safety.passed,
      limitations: packet.session_engagement_summary.limitations
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
