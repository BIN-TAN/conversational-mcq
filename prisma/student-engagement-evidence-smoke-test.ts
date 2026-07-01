import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  buildEngagementEvidencePacketForSession,
  buildItemEngagementEvidence,
  EngagementEvidencePacketV1Schema,
  ENGAGEMENT_RULE_CONFIG_V1,
  redactEngagementEvidencePacketForReview,
  summarizeSessionEngagement,
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
  assert(
    rapid.engagement_signal === "moderately_engaged",
    "A single rapid sparse response should not become disengaged by itself."
  );
  assert(
    rapid.decision_trace.matched_rules.some((rule) => rule.rule_id === "rapid_minimal_reasoning_combo"),
    "Rapid sparse response should include the rapid/minimal rule trace."
  );
  assert(
    rapid.decision_trace.non_matched_rules.some((rule) => rule.rule_id === "repeated_invalid_or_unusable_response"),
    "Rapid sparse response should explain that invalid-response rule did not match."
  );

  const minimalOnly = buildItemEngagementEvidence({
    item_public_id: "minimal_only_item",
    response_present: true,
    selected_option: "B",
    reasoning_text: "short",
    item_response_time_ms: 28_000,
    revision_count: 0,
    event_counts: { typing_activity_summary: 1 },
    process_instrumentation_available: true
  });
  assert(
    minimalOnly.engagement_signal === "moderately_engaged",
    "Minimal reasoning alone should not become disengaged."
  );
  assert(
    minimalOnly.decision_trace.matched_rules.some((rule) => rule.rule_id === "minimal_reasoning_only"),
    "Minimal reasoning should include a matched trace."
  );
  assert(
    minimalOnly.decision_trace.non_matched_rules.some((rule) =>
      rule.thresholds_used.some((threshold) => threshold.threshold_name === "full_item_completion_rapid_ms")
    ),
    "Minimal-only trace should show the full-item rapid threshold did not match."
  );

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
  assert(
    idk.engagement_signal === "moderately_engaged",
    "I don't know should remain separate from ability evidence."
  );
  assert(
    !idk.decision_trace.matched_rules.some((rule) => rule.rule_id === "repeated_invalid_or_unusable_response"),
    "I don't know alone must not be treated as invalid engagement evidence."
  );

  const wrongAnswerAlone = buildItemEngagementEvidence({
    item_public_id: "wrong_answer_alone_item",
    response_present: true,
    selected_option: "A",
    reasoning_text: "I think the parameter describes how the item behaves across students.",
    item_response_time_ms: 28_000,
    revision_count: 0,
    event_counts: { typing_activity_summary: 1 },
    process_instrumentation_available: true
  });
  assert(
    wrongAnswerAlone.engagement_signal !== "disengaged",
    "Wrong answer marker alone must not be invalid engagement evidence."
  );

  const proceduralQuestion = buildItemEngagementEvidence({
    item_public_id: "procedural_question_item",
    response_present: true,
    selected_option: "C",
    reasoning_text: "I am asking how to format this, then giving my reason.",
    item_response_time_ms: 30_000,
    revision_count: 0,
    event_counts: { procedural_clarification_request: 1 },
    process_instrumentation_available: true
  });
  assert(
    proceduralQuestion.engagement_signal !== "disengaged",
    "Procedural question alone must not be invalid engagement evidence."
  );

  const singlePaste = buildItemEngagementEvidence({
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
    singlePaste.ai_assistance_signal === "insufficient_evidence",
    "Paste alone should remain insufficient evidence."
  );
  assert(
    singlePaste.possible_interpretation.includes("single weak signal"),
    "Single weak process signal should produce a cautious interpretation."
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
  assert(
    likelyExternal.ai_assistance_decision_trace.matched_rules.some(
      (rule) => rule.rule_id === "convergent_paste_focus_context"
    ),
    "Likely external-assistance signal should include matched convergent rule."
  );
  assert(
    likelyExternal.interpretation_source === "deterministic_v1",
    "Engagement interpretation should be explicitly deterministic."
  );
  assert(
    likelyExternal.possible_interpretation.includes("student self-report"),
    "Likely external-assistance interpretation should mention self-report comparison."
  );

  const weakDisengagementConvergence = buildItemEngagementEvidence({
    item_public_id: "weak_convergent_item",
    response_present: true,
    selected_option: "E",
    reasoning_text: "idk",
    item_response_time_ms: 900,
    revision_count: 0,
    event_counts: { repeated_invalid_response: 1 },
    process_instrumentation_available: true
  });
  assert(
    weakDisengagementConvergence.engagement_signal === "disengaged",
    "Convergent weak participation signals should support disengaged."
  );
  assert(
    weakDisengagementConvergence.decision_trace.matched_rules.some(
      (rule) => rule.thresholds_used.some((threshold) => threshold.threshold_name === "repeated_invalid_response_threshold")
    ),
    "Disengaged item trace should include threshold usage."
  );

  const repeatedRapidMinimalOnlySession = summarizeSessionEngagement([
    rapid,
    buildItemEngagementEvidence({
      item_public_id: "second_rapid_minimal_item",
      response_present: true,
      selected_option: "B",
      reasoning_text: "guess",
      item_response_time_ms: 2_500,
      revision_count: 0,
      event_counts: {},
      process_instrumentation_available: true
    }),
    engaged
  ]);
  assert(
    repeatedRapidMinimalOnlySession.provisional_engagement_category === "disengaged",
    "Repeated rapid plus minimal reasoning across items can classify the session as disengaged."
  );
  assert(
    repeatedRapidMinimalOnlySession.session_decision_trace.matched_session_rules.some((rule) =>
      rule.thresholds_used.some((threshold) => threshold.threshold_name === "full_item_completion_rapid_ms")
    ),
    "Repeated rapid/minimal session trace should include full-item completion threshold."
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
  assert(
    unavailable.interpretation_cautions.includes("ai_assistance_signal_should_be_compared_with_self_report"),
    "Updated AI-signal limitation should be present."
  );

  const repeatedWeakSession = summarizeSessionEngagement([
    weakDisengagementConvergence,
    buildItemEngagementEvidence({
      item_public_id: "second_weak_convergent_item",
      response_present: true,
      selected_option: "A",
      reasoning_text: "ok",
      item_response_time_ms: 1_000,
      revision_count: 0,
      event_counts: { response_quality_rejected: ENGAGEMENT_RULE_CONFIG_V1.repeated_invalid_response_threshold },
      process_instrumentation_available: true
    }),
    minimalOnly
  ]);
  assert(
    repeatedWeakSession.provisional_engagement_category === "disengaged",
    "Repeated rapid/minimal/invalid signals across multiple items can classify disengaged."
  );
  assert(
    repeatedWeakSession.session_decision_trace.matched_session_rules.some(
      (rule) => rule.rule_id === "multiple_items_rapid_sparse"
    ),
    "Session trace should explain repeated disengagement item threshold."
  );
  assert(
    repeatedWeakSession.session_decision_trace.matched_session_rules.some((rule) =>
      rule.thresholds_used.some((threshold) => threshold.threshold_name === "disengaged_min_item_count")
    ),
    "Session trace should include disengaged item-count threshold."
  );

  const mixedSession = summarizeSessionEngagement([engaged, minimalOnly, unavailable]);
  assert(
    ["moderately_engaged", "insufficient_evidence"].includes(mixedSession.provisional_engagement_category),
    "Mixed item signals should remain moderate or insufficient, not overclaim disengaged."
  );
  assert(
    mixedSession.session_decision_trace.why_not_other_categories.length > 0,
    "Session trace should include why-not category reasons."
  );

  const oneFocus = buildItemEngagementEvidence({
    item_public_id: "single_focus_item",
    response_present: true,
    selected_option: "B",
    reasoning_text: "This is a moderate explanation.",
    item_response_time_ms: 40_000,
    revision_count: 0,
    event_counts: { window_blur: 1 },
    process_instrumentation_available: true
  });
  assert(
    oneFocus.ai_assistance_signal === "insufficient_evidence",
    "One focus loss alone should not produce likely external-assistance pattern."
  );
  assert(
    singlePaste.ai_assistance_decision_trace.why_not_likely_external_assistance_pattern.some(
      (reason) => reason.reason_code === "single_weak_signal_is_not_enough"
    ),
    "Single paste should include why-not-likely reason."
  );
  assert(
    summarizeSessionEngagement([engaged, wrongAnswerAlone, proceduralQuestion]).ai_assistance_decision_trace
      .why_not_likely_external_assistance_pattern.some(
        (reason) => reason.reason_code === "no_convergent_focus_paste_typing_pattern"
      ),
    "none_indicated AI trace should include why-not likely reason."
  );
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
    assert(
      parsed.engagement_rule_config.threshold_policy === "provisional_v1_not_empirically_calibrated",
      "Engagement packet should include threshold policy."
    );
    assert(
      parsed.item_engagement_evidence.every((item) => item.interpretation_source === "deterministic_v1"),
      "Every item should include deterministic interpretation source."
    );
    assert(
      parsed.item_engagement_evidence.every((item) => item.decision_trace.matched_rules.length > 0),
      "Every item should include item-level decision trace."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.matched_session_rules.length > 0,
      "Session summary should include matched session rules."
    );
    assert(
      Array.isArray(
        parsed.session_engagement_summary.ai_assistance_decision_trace.why_not_likely_external_assistance_pattern
      ),
      "Session summary should include AI assistance trace."
    );
    assert(
      parsed.item_engagement_evidence.every((item) => item.possible_interpretation.length > 0),
      "Every item should include a possible interpretation."
    );
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
    assert(!text.includes("clipboard_text"), "Redacted engagement artifact leaked clipboard text key.");
    assert(!text.includes("raw_url"), "Redacted engagement artifact leaked raw URL key.");
    assert(!text.includes("possible_external_assistance_or_reference"), "Old AI-assistance signal must not appear.");
    assert(!text.includes("ai_assistance_signal_requires_human_contextual_review"), "Old AI-assistance limitation must not appear.");
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
