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

type PackageTimingForTest = NonNullable<Parameters<typeof summarizeSessionEngagement>[1]>;
type PackageTimingSourceForTest = PackageTimingForTest["timing_source_used_for_rapid_rule"];
type PackageTimingBandForTest = PackageTimingForTest["timing_reconstruction"]["wall_clock_band"];
type TimingEventSourceForTest = PackageTimingForTest["timing_reconstruction"]["first_item_presented_event"]["source"];

function packageBandForTest(milliseconds?: number | null): PackageTimingBandForTest {
  if (!milliseconds || milliseconds <= 0) return "package_timing_unavailable";
  if (milliseconds <= ENGAGEMENT_RULE_CONFIG_V1.initial_package_ultra_rapid_ms) return "package_ultra_rapid";
  if (milliseconds <= ENGAGEMENT_RULE_CONFIG_V1.initial_package_extreme_rapid_ms) return "package_extreme_rapid";
  if (milliseconds <= ENGAGEMENT_RULE_CONFIG_V1.initial_package_rapid_warning_ms) return "package_rapid_warning";
  return "package_typical_or_long";
}

function itemTimeBandForTest(milliseconds?: number | null) {
  if (!milliseconds || milliseconds <= 0) return "missing";
  if (milliseconds < 3_000) return "under_3_sec";
  if (milliseconds < 15_000) return "3_15_sec";
  if (milliseconds < 60_000) return "15_60_sec";
  if (milliseconds < 180_000) return "1_3_min";
  return "over_3_min";
}

function packageTimingForTest(input: {
  wall?: number | null;
  active?: number | null;
  sum?: number | null;
  focus?: number | null;
  typing?: number | null;
  source?: PackageTimingSourceForTest;
  baseline?: boolean;
  dataQuality?: boolean;
  limitations?: string[];
  itemDurations?: number[];
  itemTypingDurations?: number[];
}): PackageTimingForTest {
  const source: PackageTimingSourceForTest =
    input.source ??
    (input.focus !== undefined && input.focus !== null
      ? "focus_adjusted_task"
      : input.sum !== undefined && input.sum !== null
        ? "sum_item_focus_adjusted"
        : input.active !== undefined && input.active !== null
          ? "response_production"
          : input.wall !== undefined && input.wall !== null
            ? "wall_clock_fallback"
            : "unavailable");
  const rapidDuration =
    source === "focus_adjusted_task"
      ? input.focus ?? null
      : source === "sum_item_focus_adjusted"
        ? input.sum ?? null
        : source === "response_production"
          ? input.active ?? null
          : source === "wall_clock_fallback"
            ? input.wall ?? null
            : null;
  const limitations = input.limitations ?? [
    ...(input.focus === undefined || input.focus === null ? ["focus_adjusted_task_timing_unavailable"] : []),
    ...(input.sum === undefined || input.sum === null ? ["sum_item_focus_adjusted_timing_unavailable"] : []),
    ...(input.active === undefined || input.active === null ? ["response_production_timing_unavailable"] : []),
    ...((input.focus === undefined || input.focus === null) &&
    (input.sum === undefined || input.sum === null) &&
    (input.active === undefined || input.active === null)
      ? ["active_package_timing_unavailable"]
      : []),
    ...(input.typing === undefined || input.typing === null ? ["reasoning_typing_timing_unavailable"] : []),
    ...(source === "wall_clock_fallback" ? ["wall_clock_timing_used_for_rapid_rule_fallback"] : []),
    ...(source === "unavailable" ? ["package_timing_unavailable"] : [])
  ];
  const firstItemPresentedSource: TimingEventSourceForTest =
    input.wall === undefined || input.wall === null ? "unknown" : "process_events";
  const firstStudentActionSource: TimingEventSourceForTest =
    input.active === undefined || input.active === null ? "unknown" : "process_events";

  return {
    wall_clock_duration_ms: input.wall ?? null,
    active_response_duration_ms: input.active ?? null,
    sum_item_active_duration_ms: input.sum ?? null,
    focus_adjusted_duration_ms: input.focus ?? null,
    focus_adjusted_task_duration_ms: input.focus ?? null,
    sum_item_focus_adjusted_duration_ms: input.sum ?? null,
    response_production_duration_ms: input.active ?? null,
    package_reasoning_typing_duration_ms: input.typing ?? null,
    package_reasoning_input_elapsed_time_ms: input.typing ?? null,
    timing_source_used_for_rapid_rule: source,
    rapid_rule_duration_ms: rapidDuration,
    rapid_rule_timing_approximate: source === "wall_clock_fallback" || source === "unavailable",
    baseline_completion_observed: input.baseline ?? true,
    data_quality_events_observed: input.dataQuality ?? true,
    timing_limitations: limitations,
    item_timing_by_public_id: Object.fromEntries(
      (input.itemDurations ?? []).map((duration, index) => {
        const itemPublicId = `test_item_${index + 1}`;
        const typingDuration = input.itemTypingDurations?.[index] ?? null;
        return [
          itemPublicId,
          {
            item_public_id: itemPublicId,
            wall_clock_band: packageBandForTest(duration),
            focus_adjusted_task_band: packageBandForTest(duration),
            response_production_band: packageBandForTest(duration),
            reasoning_typing_band:
              typingDuration === null
                ? "reasoning_typing_unavailable"
                : typingDuration <= ENGAGEMENT_RULE_CONFIG_V1.item_reasoning_typing_rapid_ms
                  ? "reasoning_typing_very_low"
                  : typingDuration <= ENGAGEMENT_RULE_CONFIG_V1.package_reasoning_typing_low_ms
                    ? "reasoning_typing_low"
                    : "reasoning_typing_typical_or_high",
            reasoning_typing_basis: typingDuration === null ? "unavailable" : "typing_activity_summary",
            timing_limitations: typingDuration === null ? ["reasoning_typing_timing_unavailable"] : []
          }
        ];
      })
    ),
    timing_reconstruction: {
      first_item_presented_event: {
        event_type: input.wall === undefined || input.wall === null ? "unknown" : "item_presented",
        occurred_at: input.wall === undefined || input.wall === null ? null : "2026-07-01T00:00:00.000Z",
        source: firstItemPresentedSource
      },
      first_student_action_event: {
        event_type: input.active === undefined || input.active === null ? "unknown" : "option_clicked",
        occurred_at: input.active === undefined || input.active === null ? null : "2026-07-01T00:00:01.000Z",
        source: firstStudentActionSource
      },
      package_submitted_event: {
        event_type: "package_submitted",
        occurred_at: "2026-07-01T00:00:10.000Z",
        source: "process_events"
      },
      wall_clock_duration_ms: input.wall ?? null,
      active_response_duration_ms: input.active ?? null,
      sum_item_active_duration_ms: input.sum ?? null,
      focus_adjusted_duration_ms: input.focus ?? null,
      focus_adjusted_task_duration_ms: input.focus ?? null,
      sum_item_focus_adjusted_duration_ms: input.sum ?? null,
      response_production_duration_ms: input.active ?? null,
      package_reasoning_typing_duration_ms: input.typing ?? null,
      package_reasoning_input_elapsed_time_ms: input.typing ?? null,
      wall_clock_band: packageBandForTest(input.wall),
      active_response_band: packageBandForTest(input.active),
      sum_item_active_band: packageBandForTest(input.sum),
      focus_adjusted_band: packageBandForTest(input.focus),
      focus_adjusted_task_band: packageBandForTest(input.focus),
      sum_item_focus_adjusted_band: packageBandForTest(input.sum),
      response_production_band: packageBandForTest(input.active),
      reasoning_typing_band:
        input.typing === undefined || input.typing === null
          ? "reasoning_typing_unavailable"
          : input.typing <= ENGAGEMENT_RULE_CONFIG_V1.package_reasoning_typing_very_low_ms
            ? "reasoning_typing_very_low"
            : input.typing <= ENGAGEMENT_RULE_CONFIG_V1.package_reasoning_typing_low_ms
              ? "reasoning_typing_low"
              : "reasoning_typing_typical_or_high",
      timing_source_used_for_rapid_rule: source,
      timing_limitations: limitations,
      item_active_timing_reconstruction: (input.itemDurations ?? []).map((duration, index) => ({
        item_public_id: `test_item_${index + 1}`,
        first_student_action_event_type: "option_clicked",
        item_completed_event_type: "item_completed",
        active_duration_band: itemTimeBandForTest(duration),
        active_duration_ms: duration,
        timing_limitations: []
      })),
      typing_timing_reconstruction: (input.itemDurations ?? []).map((_, index) => {
        const itemPublicId = `test_item_${index + 1}`;
        const typingDuration = input.itemTypingDurations?.[index] ?? null;
        return {
          item_public_id: itemPublicId,
          field_type: "item_text_input_elapsed_time",
          typing_duration_band:
            typingDuration === null
              ? "reasoning_typing_unavailable"
              : typingDuration <= ENGAGEMENT_RULE_CONFIG_V1.item_reasoning_typing_rapid_ms
                ? "reasoning_typing_very_low"
                : typingDuration <= ENGAGEMENT_RULE_CONFIG_V1.package_reasoning_typing_low_ms
                  ? "reasoning_typing_low"
                  : "reasoning_typing_typical_or_high",
          typing_duration_ms: typingDuration,
          typing_event_count: typingDuration === null ? 0 : 1,
          start_event_type: typingDuration === null ? "unknown" : "first_keydown_inferred_from_typing_summary",
          end_event_type: typingDuration === null ? "unknown" : "typing_activity_summary_flush",
          includes_idle_time: typingDuration === null ? "unknown" : true,
          includes_blur_time: "unknown",
          timing_limitations:
            typingDuration === null
              ? [
                  "reasoning_input_elapsed_time_unavailable",
                  "active_typing_time_unavailable",
                  "field_type_inferred_from_current_item_context"
                ]
              : [
                  "active_typing_time_unavailable",
                  "field_type_inferred_from_current_item_context",
                  "duration_is_reasoning_input_elapsed_time_not_active_typing_time",
                  "typing_summary_flush_trigger_not_persisted"
                ]
        };
      })
    }
  };
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

  const veryLowTypingSparse = buildItemEngagementEvidence({
    item_public_id: "very_low_typing_sparse_item",
    response_present: true,
    selected_option: "B",
    reasoning_text: "short",
    item_response_time_ms: 38_000,
    item_timing: {
      item_public_id: "very_low_typing_sparse_item",
      wall_clock_band: "package_typical_or_long",
      focus_adjusted_task_band: "package_timing_unavailable",
      response_production_band: "package_typical_or_long",
      reasoning_typing_band: "reasoning_typing_very_low",
      reasoning_typing_basis: "typing_activity_summary",
      timing_limitations: []
    },
    revision_count: 0,
    event_counts: { typing_activity_summary: 1 },
    process_instrumentation_available: true
  });
  assert(
    veryLowTypingSparse.engagement_signal === "moderately_engaged",
    "Very low reasoning typing plus sparse reasoning should not classify a single item as disengaged by itself."
  );
  assert(
    veryLowTypingSparse.decision_trace.matched_rules.some(
      (rule) => rule.rule_id === "very_low_item_reasoning_typing_sparse"
    ),
    "Item trace should include very-low reasoning typing basis."
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

  const becauseOnly = buildItemEngagementEvidence({
    item_public_id: "because_only_item",
    response_present: true,
    selected_option: "B",
    reasoning_text: "because",
    item_response_time_ms: 6_000,
    revision_count: 0,
    event_counts: {},
    process_instrumentation_available: true
  });
  assert(
    !becauseOnly.decision_trace.matched_rules.some((rule) => rule.rule_id === "meaningful_reasoning_or_revision"),
    "Minimal text such as 'because' should not count as meaningful reasoning counterevidence."
  );
  assert(
    becauseOnly.substantive_reasoning_basis === "not_substantive_low_information",
    "Minimal text should record a low-information substantive reasoning basis."
  );

  const longIrrelevant = buildItemEngagementEvidence({
    item_public_id: "long_irrelevant_item",
    response_present: true,
    selected_option: "B",
    reasoning_text:
      "banana banana banana banana banana banana banana banana banana banana banana banana banana banana banana banana",
    item_response_time_ms: 18_000,
    revision_count: 0,
    event_counts: { typing_activity_summary: 1 },
    process_instrumentation_available: true
  });
  assert(
    longIrrelevant.substantive_reasoning_basis === "not_substantive_low_information",
    "Long but irrelevant or repeated placeholder text should not count as substantive."
  );
  assert(
    !longIrrelevant.decision_trace.matched_rules.some((rule) => rule.rule_id === "meaningful_reasoning_or_revision"),
    "Long irrelevant text should not match meaningful reasoning."
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

  const ultraRapidSparsePackage = summarizeSessionEngagement(
    [rapid, becauseOnly, idk],
    packageTimingForTest({ wall: 180_000, active: 7_500, sum: 7_200, focus: 7_000, typing: 6_000 })
  );
  assert(
    ultraRapidSparsePackage.provisional_engagement_category === "disengaged",
    "Wall-clock typical/long should not hide ultra-rapid active sparse answering."
  );
  assert(
    ultraRapidSparsePackage.category_confidence === "high",
    "Reliable active ultra-rapid sparse package timing should produce high confidence."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.package_duration_band === "package_ultra_rapid",
    "Session trace should use active ultra-rapid duration band for rapid rules."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.package_timing.wall_clock_band === "package_typical_or_long",
    "Session trace should retain the wall-clock band separately."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.package_timing.focus_adjusted_task_band === "package_ultra_rapid",
    "Session trace should include the focus-adjusted task band."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.package_timing.response_production_band === "package_ultra_rapid",
    "Session trace should include the response-production band."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.package_timing.reasoning_typing_band ===
      "reasoning_typing_very_low",
    "Session trace should include the package reasoning typing band."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.package_timing.timing_source_used_for_rapid_rule ===
      "focus_adjusted_task",
    "Focus-adjusted task timing should be preferred for rapid sparse rules."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.timing_reconstruction.first_item_presented_event.event_type ===
      "item_presented",
    "Timing reconstruction should include first item event."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.timing_reconstruction.first_student_action_event.event_type ===
      "option_clicked",
    "Timing reconstruction should include first student action event."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.timing_reconstruction.package_submitted_event.event_type ===
      "package_submitted",
    "Timing reconstruction should include package submitted event."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.timing_reconstruction.active_response_duration_ms === 7_500,
    "Response-production duration should use first student action, not first item presentation."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.timing_reconstruction.wall_clock_duration_ms === 180_000,
    "Timing reconstruction should preserve wall-clock duration separately."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.package_timing.package_ultra_rapid_rule_matched,
    "Ultra rapid sparse rule should match."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.package_timing.reasoning_typing_very_low_rule_matched,
    "Very low reasoning typing with repeated sparse evidence should be traceable."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.sparse_item_count >= 2,
    "Session trace should include sparse item count."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.substantive_item_count === 0,
    "Ultra sparse package should record no substantive item counterevidence."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.matched_session_rules.some(
      (rule) => rule.rule_id === "initial_package_ultra_rapid_sparse"
    ),
    "Session trace should include initial_package_ultra_rapid_sparse."
  );
  assert(
    !ultraRapidSparsePackage.session_decision_trace.top_counterevidence.includes("completed_three_items"),
    "Completed three items should not be top counterevidence against ultra rapid sparse disengagement."
  );
  assert(
    !ultraRapidSparsePackage.session_decision_trace.top_counterevidence.includes("process_events_observed"),
    "Process events observed should be data-quality evidence, not engagement counterevidence."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.completed_three_items_counterevidence_explanation.includes(
      "baseline_completion"
    ),
    "Trace should explain why completed items are baseline completion context."
  );
  assert(
    ultraRapidSparsePackage.session_decision_trace.meaningful_reasoning_counterevidence_explanation.includes(
      "not_counted"
    ),
    "Trace should explain why meaningful reasoning counterevidence was not counted."
  );

  const extremeRapidSparsePackage = summarizeSessionEngagement(
    [rapid, becauseOnly, idk],
    packageTimingForTest({ wall: 75_000, active: 12_000 })
  );
  assert(
    extremeRapidSparsePackage.provisional_engagement_category === "disengaged",
    "Response-production duration under 15 seconds with repeated sparse evidence should classify as disengaged when focus-adjusted timing is unavailable."
  );
  assert(
    extremeRapidSparsePackage.session_decision_trace.package_timing.package_extreme_rapid_rule_matched,
    "Extreme rapid sparse rule should match."
  );
  assert(
    extremeRapidSparsePackage.session_decision_trace.package_timing.timing_source_used_for_rapid_rule ===
      "response_production",
    "Response-production timing should be used only after focus-adjusted timing is unavailable."
  );

  const sumItemFocusSparsePackage = summarizeSessionEngagement(
    [rapid, becauseOnly, idk],
    packageTimingForTest({ wall: 120_000, active: 80_000, sum: 7_800 })
  );
  assert(
    sumItemFocusSparsePackage.provisional_engagement_category === "disengaged",
    "Summed item focus-adjusted duration under 8 seconds should classify repeated sparse evidence as disengaged."
  );
  assert(
    sumItemFocusSparsePackage.session_decision_trace.package_timing.timing_source_used_for_rapid_rule ===
      "sum_item_focus_adjusted",
    "Summed item focus-adjusted timing should be preferred over response-production timing."
  );

  const fallbackWallClockSparsePackage = summarizeSessionEngagement(
    [rapid, becauseOnly, idk],
    packageTimingForTest({ wall: 7_000, source: "wall_clock_fallback" })
  );
  assert(
    fallbackWallClockSparsePackage.provisional_engagement_category === "disengaged",
    "Fallback wall-clock ultra rapid timing can support disengagement when sparse evidence repeats."
  );
  assert(
    fallbackWallClockSparsePackage.category_confidence === "medium",
    "Fallback wall-clock rapid timing should lower confidence to medium."
  );
  assert(
    fallbackWallClockSparsePackage.session_decision_trace.package_timing.timing_limitations.includes(
      "wall_clock_timing_used_for_rapid_rule_fallback"
    ),
    "Fallback wall-clock use should be explicit in timing limitations."
  );

  const secondSubstantive = buildItemEngagementEvidence({
    item_public_id: "second_substantive_item",
    response_present: true,
    selected_option: "D",
    reasoning_text:
      "The item parameter describes the item, while the theta value describes the person on the latent trait scale.",
    item_response_time_ms: 18_000,
    revision_count: 0,
    event_counts: { typing_activity_summary: 1 },
    process_instrumentation_available: true
  });
  const rapidMixedPackage = summarizeSessionEngagement(
    [engaged, secondSubstantive, minimalOnly],
    packageTimingForTest({ wall: 110_000, active: 24_000 })
  );
  assert(
    rapidMixedPackage.provisional_engagement_category !== "disengaged",
    "Rapid-warning timing with strong substantive reasoning should not automatically disengage."
  );
  assert(
    !rapidMixedPackage.session_decision_trace.package_timing.package_rapid_warning_rule_matched,
    "Strong substantive counterevidence should prevent the rapid-warning sparse rule."
  );

  const rapidWarningMixedPackage = summarizeSessionEngagement(
    [rapid, minimalOnly, secondSubstantive],
    packageTimingForTest({ wall: 95_000, active: 24_000 })
  );
  assert(
    rapidWarningMixedPackage.provisional_engagement_category === "moderately_engaged",
    "Active response duration between 15 and 30 seconds with mixed evidence can remain moderately engaged."
  );
  assert(
    rapidWarningMixedPackage.session_decision_trace.package_timing.package_rapid_warning_rule_matched,
    "Rapid-warning sparse rule should be traceable when mixed evidence is weak."
  );

  const slowSparseIdk = buildItemEngagementEvidence({
    item_public_id: "slow_sparse_idk_item",
    response_present: true,
    selected_option: "E",
    reasoning_text: "I don't know the reason yet.",
    item_response_time_ms: 38_000,
    revision_count: 0,
    event_counts: { idk_selected: 1 },
    process_instrumentation_available: true
  });
  const slowMinimal = buildItemEngagementEvidence({
    item_public_id: "slow_minimal_item",
    response_present: true,
    selected_option: "B",
    reasoning_text: "short",
    item_response_time_ms: 32_000,
    revision_count: 0,
    event_counts: { typing_activity_summary: 1 },
    process_instrumentation_available: true
  });
  const activeUnavailableLongWallClock = summarizeSessionEngagement(
    [slowSparseIdk, slowMinimal, wrongAnswerAlone],
    packageTimingForTest({ wall: 120_000, source: "wall_clock_fallback" })
  );
  assert(
    activeUnavailableLongWallClock.provisional_engagement_category === "moderately_engaged",
    "Unavailable active timing with typical/long wall clock should not force disengaged."
  );
  assert(
    activeUnavailableLongWallClock.session_decision_trace.package_timing.timing_limitations.includes(
      "active_package_timing_unavailable"
    ),
    "Active timing unavailable should be explicit."
  );

  const veryLowTypingWithoutRapidTiming = summarizeSessionEngagement(
    [slowSparseIdk, slowMinimal, wrongAnswerAlone],
    packageTimingForTest({ wall: 120_000, source: "wall_clock_fallback", typing: 5_000 })
  );
  assert(
    veryLowTypingWithoutRapidTiming.provisional_engagement_category !== "disengaged",
    "Very low reasoning typing time alone should not classify a session as disengaged."
  );
  assert(
    veryLowTypingWithoutRapidTiming.session_decision_trace.package_timing
      .reasoning_typing_very_low_rule_matched,
    "Very low reasoning typing with repeated sparse evidence should still be traceable."
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

  await logProcessEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    event_type: "typing_activity_summary",
    event_category: "student_process",
    event_source: "frontend",
    payload: {
      key_count: 99,
      backspace_count: 0,
      enter_key_count: 0,
      duration_ms: 999_999
    }
  });
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
      parsed.engagement_rule_config.initial_package_ultra_rapid_ms ===
        ENGAGEMENT_RULE_CONFIG_V1.initial_package_ultra_rapid_ms,
      "Engagement packet should include package ultra rapid threshold."
    );
    assert(
      parsed.engagement_rule_config.initial_package_extreme_rapid_ms ===
        ENGAGEMENT_RULE_CONFIG_V1.initial_package_extreme_rapid_ms,
      "Engagement packet should include package extreme rapid threshold."
    );
    assert(
      parsed.engagement_rule_config.initial_package_rapid_warning_ms ===
        ENGAGEMENT_RULE_CONFIG_V1.initial_package_rapid_warning_ms,
      "Engagement packet should include package rapid-warning threshold."
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
      parsed.item_engagement_evidence.every((item) => item.item_timing.item_public_id === item.item_public_id),
      "Every item should include safe item timing diagnostics."
    );
    assert(
      parsed.item_engagement_evidence.every((item) => item.item_timing.reasoning_typing_basis),
      "Every item timing trace should include reasoning typing basis."
    );
    assert(
      parsed.item_engagement_evidence.some(
        (item) => item.item_timing.reasoning_typing_basis === "typing_activity_summary"
      ),
      "Typing summary events should be reflected in item timing basis."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.matched_session_rules.length > 0,
      "Session summary should include matched session rules."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.package_duration_band !==
        "package_timing_unavailable",
      "Session summary should include package-level timing band."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.package_duration_thresholds_used.some(
        (threshold) => threshold.threshold_name === "initial_package_rapid_warning_ms"
      ),
      "Session summary should include package-level timing thresholds."
    );
    assert(
    parsed.session_engagement_summary.session_decision_trace.package_timing.timing_source_used_for_rapid_rule !==
        "unavailable",
      "Session summary should include the timing source used for rapid rules."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.package_timing.response_production_band !==
        "package_timing_unavailable",
      "Session summary should include response-production timing band."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.package_timing.reasoning_typing_band !==
        undefined,
      "Session summary should include package reasoning typing band."
    );
    assert(
      typeof parsed.session_engagement_summary.session_decision_trace.package_timing
        .reasoning_typing_very_low_rule_matched === "boolean",
      "Session summary should include reasoning typing rule match status."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.timing_reconstruction.first_item_presented_event
        .event_type !== "unknown",
      "Timing reconstruction should include a first item presentation event."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.timing_reconstruction.first_student_action_event
        .event_type !== "unknown",
      "Timing reconstruction should include a first student action event."
    );
    assert(
      ["package_submitted", "initial_response_package_created"].includes(
        parsed.session_engagement_summary.session_decision_trace.timing_reconstruction.package_submitted_event
          .event_type
      ),
      "Timing reconstruction should identify the initial package terminal marker."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.timing_reconstruction.first_student_action_event
        .event_type !== "item_presented",
      "Active response duration should be anchored to a student action, not item presentation."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.timing_reconstruction
        .item_active_timing_reconstruction.length === 3,
      "Timing reconstruction should include one safe per-item timing record per item."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.timing_reconstruction
        .item_active_timing_reconstruction.every(
          (entry) =>
            entry.item_public_id &&
            entry.first_student_action_event_type &&
            entry.item_completed_event_type &&
            entry.active_duration_band
        ),
      "Each per-item timing reconstruction should include safe event types and bands."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.timing_reconstruction
        .typing_timing_reconstruction.length === 3,
      "Timing reconstruction should include one safe per-item typing timing record per item."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.timing_reconstruction
        .typing_timing_reconstruction.every(
          (entry) =>
            entry.item_public_id &&
            entry.field_type === "item_text_input_elapsed_time" &&
            typeof entry.typing_event_count === "number" &&
            entry.start_event_type &&
            entry.end_event_type &&
            Array.isArray(entry.timing_limitations)
        ),
      "Each typing timing reconstruction should include safe field scope, event counts, event labels, and limitations."
    );
    const typingReconstruction =
      parsed.session_engagement_summary.session_decision_trace.timing_reconstruction
        .typing_timing_reconstruction;
    const summedItemTypingDuration = typingReconstruction.reduce(
      (total, entry) => total + (entry.typing_duration_ms ?? 0),
      0
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.timing_reconstruction
        .package_reasoning_input_elapsed_time_ms === summedItemTypingDuration,
      "Package reasoning-input elapsed time should be the sum of item-scoped typing summaries only."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.timing_reconstruction
        .package_reasoning_input_elapsed_time_ms === 60_000,
      "Unscoped typing summaries should not be included in package reasoning-input elapsed time."
    );
    assert(
      typingReconstruction.some((entry) => entry.includes_idle_time === true),
      "Typing elapsed time should be labeled as idle-inclusive when duration is available."
    );
    assert(
      typingReconstruction.every((entry) =>
        entry.timing_limitations.includes("active_typing_time_unavailable")
      ),
      "Typing timing reconstruction should state that active typing time is unavailable."
    );
    assert(
      typeof parsed.session_engagement_summary.session_decision_trace.package_timing
        .package_ultra_rapid_rule_matched === "boolean",
      "Session summary should include ultra rapid rule match status."
    );
    assert(
      Object.keys(
        parsed.session_engagement_summary.session_decision_trace.substantive_reasoning_basis_counts
      ).length > 0,
      "Session summary should include substantive reasoning basis counts."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.completed_three_items_counterevidence_explanation
        .length > 0,
      "Session summary should explain completed-three-items counterevidence role."
    );
    assert(
      parsed.session_engagement_summary.session_decision_trace.process_events_counterevidence_explanation.includes(
        "data"
      ),
      "Session summary should explain process events as data-quality context."
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
    assert(!text.includes("raw typed"), "Redacted engagement artifact leaked raw typing language.");
    assert(!text.includes("\"payload\""), "Redacted engagement artifact leaked raw process payload key.");
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
