import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  buildEngagementEvidencePacketForSession,
  buildItemEngagementEvidence,
  EngagementEvidencePacketV1Schema,
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

function configureNoLiveRuntime() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";
}

function serialized(value: unknown) {
  return JSON.stringify(value).toLowerCase();
}

function runPureEngagementAssertions() {
  const engaged = buildItemEngagementEvidence({
    item_public_id: "engaged_item",
    response_present: true,
    selected_option: "C",
    reasoning_text:
      "I separated the person ability estimate from item parameters and explained why linked forms should remain comparable.",
    item_response_time_ms: 48_000,
    revision_count: 1,
    event_counts: { typing_activity_summary: 1 },
    process_instrumentation_available: true
  });
  assert(engaged.engagement_signal === "engaged", "Meaningful reasoning should be engaged.");
  assert(engaged.ai_assistance_signal === "none_indicated", "Typing summary alone should not imply external assistance.");

  const rapid = buildItemEngagementEvidence({
    item_public_id: "rapid_item",
    response_present: true,
    selected_option: "A",
    reasoning_text: "idk",
    item_response_time_ms: 900,
    revision_count: 0,
    event_counts: {},
    process_instrumentation_available: true
  });
  assert(rapid.engagement_signal === "disengaged", "Rapid sparse response should be a disengagement signal.");

  const idk = buildItemEngagementEvidence({
    item_public_id: "idk_item",
    response_present: true,
    selected_option: "E",
    reasoning_text: "I don't know the reason yet.",
    item_response_time_ms: 22_000,
    revision_count: 0,
    event_counts: { idk_selected: 1 },
    process_instrumentation_available: true
  });
  assert(idk.idk_or_insufficient_knowledge_marked, "I don't know evidence should be marked.");
  assert(idk.engagement_signal === "moderately_engaged", "I don't know should not be treated as misconduct or ability evidence.");

  const possibleExternal = buildItemEngagementEvidence({
    item_public_id: "paste_item",
    response_present: true,
    selected_option: "C",
    reasoning_text: "This is a moderate explanation.",
    item_response_time_ms: 40_000,
    revision_count: 0,
    event_counts: { paste_detected: 1 },
    process_instrumentation_available: true
  });
  assert(
    possibleExternal.ai_assistance_signal === "possible_external_assistance_or_reference",
    "Paste alone should be possible external assistance/reference, not a misconduct label."
  );

  const likelyExternal = buildItemEngagementEvidence({
    item_public_id: "paste_focus_item",
    response_present: true,
    selected_option: "C",
    reasoning_text: "This is a moderate explanation.",
    item_response_time_ms: 40_000,
    revision_count: 0,
    event_counts: { paste_detected: 1, window_blur: 1 },
    process_instrumentation_available: true
  });
  assert(
    likelyExternal.ai_assistance_signal === "likely_external_assistance_pattern",
    "Paste plus focus loss should be a stronger contextual signal."
  );

  const unavailable = buildItemEngagementEvidence({
    item_public_id: "missing_process_item",
    response_present: true,
    selected_option: "C",
    reasoning_text: "A short explanation.",
    item_response_time_ms: 20_000,
    revision_count: 0,
    event_counts: {},
    process_instrumentation_available: false
  });
  assert(unavailable.ai_assistance_signal === "insufficient_evidence", "Missing instrumentation should remain insufficient evidence.");
  assert(unavailable.evidence_confidence === "low", "Missing instrumentation should keep confidence low.");
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
    select: { item_db_id: true }
  });

  for (const [index, response] of responses.entries()) {
    await logProcessEvent({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: response.item_db_id,
      event_type: index === 1 ? "paste_detected" : "typing_activity_summary",
      event_category: "student_process",
      event_source: "frontend",
      payload:
        index === 1
          ? {
              target_kind: "textarea",
              pasted_text_length_band: "21_100",
              clipboard_type_count: 1,
              includes_plain_text: true
            }
          : {
              key_count: 40 + index,
              backspace_count: index,
              enter_key_count: 1,
              duration_ms: 30_000
            }
    });
  }
}

async function runDbPacketAssertion() {
  configureNoLiveRuntime();
  await ensureDemoStudentAssessment(prisma);
  await applyProvisionalItemDiagnosticMetadata(prisma);

  const prefix = `engagement_evidence_${Date.now()}_${randomUUID().slice(0, 8)}`;
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

    const packet = await buildEngagementEvidencePacketForSession(started.session.session_public_id);
    const parsed = EngagementEvidencePacketV1Schema.parse(packet);
    const reviewArtifact = redactEngagementEvidencePacketForReview(parsed);
    const safety = validateRedactedEngagementReviewArtifactSafety(reviewArtifact);

    assert(parsed.item_engagement_evidence.length === 3, "Engagement packet should include three initial items.");
    assert(parsed.source_response_package_refs.length === 1, "Engagement packet should trace response package source.");
    assert(
      parsed.process_data_inventory.supported_event_types.includes("paste_detected"),
      "Process inventory should list paste detection support."
    );
    assert(
      parsed.process_data_inventory.observed_event_counts.typing_activity_summary >= 1,
      "Process inventory should include typing summary observations."
    );
    assert(safety.passed, `Redacted engagement artifact safety failed: ${safety.issues.join(", ")}`);

    const text = serialized(reviewArtifact);
    assert(!text.includes("correct_option"), "Redacted engagement artifact leaked answer-key field.");
    assert(!text.includes("reasoning_text"), "Redacted engagement artifact leaked raw reasoning field.");
    assert(!text.includes("provider"), "Redacted engagement artifact should not include provider details.");
    assert(!text.includes("cheated"), "Redacted engagement artifact must not accuse cheating.");
    assert(!text.includes("used genai"), "Redacted engagement artifact must not claim GenAI use.");
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
  }
}

async function main() {
  runPureEngagementAssertions();
  await runDbPacketAssertion();
  console.log("Student engagement-evidence smoke passed. No OpenAI calls are made by this script.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
