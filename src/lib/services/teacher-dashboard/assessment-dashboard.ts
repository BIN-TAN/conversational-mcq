import { stringify } from "csv-stringify/sync";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ContentServiceError } from "@/lib/services/content/errors";
import { readTeacherItemMetadata } from "@/lib/services/content/teacher-diagnostic-context";
import { asArray, asRecord } from "@/lib/services/teacher-review/serializers";

export const TEACHER_ASSESSMENT_DASHBOARD_VERSION = "teacher-assessment-dashboard-v1" as const;

const CANDIDATE_PATTERN_THRESHOLD = 3;
const MAX_REASONING_SNIPPETS = 3;
const MAX_SNIPPET_LENGTH = 180;
const ELIGIBILITY_BASIS_ALL_ACTIVE_TEACHER_STUDENTS =
  "all_active_students_created_by_teacher_no_assessment_assignment_model" as const;
const ELIGIBILITY_BASIS_SESSION_STUDENTS_ONLY =
  "students_with_sessions_for_selected_assessment_no_assignment_model" as const;
const ATTEMPT_POLICY_LATEST_PER_STUDENT = "latest_attempt_per_student" as const;
const ENGAGEMENT_REVIEW_NO_FLAG = "No engagement concern flagged" as const;
const ENGAGEMENT_REVIEW_FLAGGED = "Flagged for engagement review" as const;
const ENGAGEMENT_REVIEW_INSUFFICIENT = "Insufficient engagement evidence" as const;

const assessmentOptionSelect = {
  assessment_public_id: true,
  title: true,
  status: true,
  folder_label: true,
  updated_at: true,
  _count: {
    select: {
      assessment_sessions: true
    }
  }
} satisfies Prisma.AssessmentSelect;

const dashboardAssessmentSelect = {
  id: true,
  assessment_public_id: true,
  title: true,
  description: true,
  diagnostic_focus: true,
  folder_label: true,
  status: true,
  release_at: true,
  close_at: true,
  concept_units: {
    orderBy: [{ order_index: "asc" }, { created_at: "asc" }],
    select: {
      concept_unit_public_id: true,
      title: true,
      order_index: true,
      administration_rules: true,
      items: {
        orderBy: [{ item_order: "asc" }, { created_at: "asc" }],
        select: {
          id: true,
          item_public_id: true,
          item_order: true,
          item_stem: true,
          options: true,
          administration_rules: true,
          included_in_published_set: true,
          status: true,
          version: true
        }
      }
    }
  }
} satisfies Prisma.AssessmentSelect;

const dashboardSessionSelect = {
  id: true,
  session_public_id: true,
  attempt_number: true,
  status: true,
  current_phase: true,
  needs_review: true,
  needs_review_reason: true,
  started_at: true,
  last_activity_at: true,
  completed_at: true,
  created_at: true,
  updated_at: true,
  user: {
    select: {
      user_id: true,
      display_name: true,
      account_status: true
    }
  },
  concept_unit_sessions: {
    select: {
      id: true,
      status: true,
      initial_completed_at: true,
      item_responses: {
        select: {
          selected_option: true,
          correct_option_snapshot: true,
          correctness: true,
          reasoning_text: true,
          confidence_rating: true,
          item_response_time_ms: true,
          item_started_at: true,
          item_submitted_at: true,
          item_version_snapshot: true,
          item_snapshot: true,
          revision_count: true,
          item: {
            select: {
              item_public_id: true,
              item_order: true,
              item_stem: true,
              options: true,
              version: true
            }
          }
        },
        orderBy: [{ item: { item_order: "asc" } }, { created_at: "asc" }]
      },
      response_packages: {
        select: {
          package_type: true,
          created_at: true
        },
        orderBy: [{ created_at: "desc" }]
      },
      student_profiles: {
        select: {
          integrated_diagnostic_profile: true,
          engagement_profile: true,
          engagement_pattern_flags: true,
          engagement_summary: true,
          evidence_sufficiency: true,
          created_at: true
        },
        orderBy: [{ created_at: "desc" }],
        take: 1
      }
    }
  }
} satisfies Prisma.AssessmentSessionSelect;

type DashboardAssessment = Prisma.AssessmentGetPayload<{ select: typeof dashboardAssessmentSelect }>;
type DashboardSession = Prisma.AssessmentSessionGetPayload<{ select: typeof dashboardSessionSelect }>;
type DashboardItem = DashboardAssessment["concept_units"][number]["items"][number];
type DashboardItemResponse = DashboardSession["concept_unit_sessions"][number]["item_responses"][number];
type DashboardProfile = DashboardSession["concept_unit_sessions"][number]["student_profiles"][number];

export type TeacherAssessmentDashboard = {
  dashboard_version: typeof TEACHER_ASSESSMENT_DASHBOARD_VERSION;
  selected_assessment_public_id: string | null;
  assessments: AssessmentDashboardOption[];
  selected_assessment: AssessmentDashboardSelectedAssessment | null;
  eligible_student_count: number;
  eligibility_basis: typeof ELIGIBILITY_BASIS_ALL_ACTIVE_TEACHER_STUDENTS | typeof ELIGIBILITY_BASIS_SESSION_STUDENTS_ONLY;
  attempt_policy: {
    policy: typeof ATTEMPT_POLICY_LATEST_PER_STUDENT;
    description: string;
  };
  has_student_data: boolean;
  candidate_pattern_threshold: number;
  summary_cards: AssessmentDashboardSummaryCards;
  status_distribution: ChartDatum[];
  detailed_status_distribution: ChartDatum[];
  progress_chart: ChartDatum[];
  understanding_distribution: ChartDatum[];
  engagement_distribution: ChartDatum[];
  engagement_review_reasons: EngagementReviewReason[];
  time_indicator: TimeIndicator;
  item_diagnostics: ItemDiagnosticSummary[];
  candidate_misconception_patterns: CandidateMisconceptionPattern[];
  export_links: {
    dashboard_csv: string | null;
    assessment_summary_csv: string | null;
    detailed_process_bundle: string | null;
  };
  notes: string[];
};

export type AssessmentDashboardOption = {
  assessment_public_id: string;
  title: string;
  status: string;
  folder_label: string | null;
  session_count: number;
};

export type AssessmentDashboardSelectedAssessment = {
  assessment_public_id: string;
  title: string;
  description: string | null;
  diagnostic_focus: string | null;
  folder_label: string | null;
  status: string;
  release_at: string | null;
  close_at: string | null;
};

export type AssessmentDashboardSummaryCards = {
  total_students: number;
  eligible_student_count: number;
  not_started: number;
  in_progress: number;
  started_not_completed: number;
  completed: number;
  exited_terminal_incomplete: number;
  unavailable: number;
  flagged_for_review: number;
  average_time_spent_minutes: number | null;
};

export type ChartDatum = {
  label: string;
  count: number;
  percentage: number;
};

export type TimeIndicator = {
  time_metric_type: "active_interaction_ms" | "elapsed_wall_clock_ms" | "unavailable";
  average_time_ms: number | null;
  median_time_ms: number | null;
  average_minutes: number | null;
  median_minutes: number | null;
  sample_size: number;
  unavailable_count: number;
  limitations: string[];
};

export type EngagementReviewReason = {
  label: string;
  count: number;
  source: "persisted_profile" | "session_review_flag";
  limitations: string[];
};

export type ItemDiagnosticSummary = {
  item_public_id: string;
  item_snapshot_public_id: string;
  assessment_snapshot_public_ids: string[];
  item_version: number | null;
  item_order: number;
  item_stem_preview: string;
  response_count: number;
  correct_count: number;
  incorrect_count: number;
  correct_percentage: number;
  incorrect_percentage: number;
  option_distribution: ChartDatum[];
  confidence_distribution: ChartDatum[];
  reasoning_quality_summary: string;
  teacher_diagnostic_context_summary: string | null;
};

export type CandidateMisconceptionPattern = {
  pattern_id: string;
  item_public_id: string;
  item_snapshot_public_id: string;
  item_order: number;
  option_selected: string;
  unique_student_count: number;
  response_count: number;
  medium_or_high_confidence_count: number;
  confidence_summary: string;
  reasoning_group_label: string;
  reasoning_grouping_method: string;
  threshold_unique_student_count: number;
  limitations: string[];
  representative_reasoning_snippets: string[];
  review_note: string;
};

type ItemAccumulator = {
  item_public_id: string;
  item_snapshot_public_id: string;
  assessment_snapshot_public_ids: Set<string>;
  item_version: number | null;
  item_order: number;
  item_stem: string;
  options: unknown;
  administration_rules: unknown;
  responses: CanonicalResponse[];
};

type PatternAccumulator = {
  item_public_id: string;
  item_snapshot_public_id: string;
  item_order: number;
  selected_option: string;
  reasoning_key: string;
  reasoning_group_label: string;
  responses: CanonicalResponse[];
  student_keys: Set<string>;
};

type CanonicalAttempt = {
  student_key: string;
  session: DashboardSession | null;
};

type CanonicalResponse = {
  student_key: string;
  session_public_id: string;
  assessment_snapshot_public_id: string;
  response: DashboardItemResponse;
};

function iso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function percent(count: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function minutes(ms: number) {
  return Math.round((ms / 60_000) * 10) / 10;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Math.round(sorted[middle] * 10) / 10;
  return Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
}

function chart(counts: Array<[string, number]>, denominator?: number): ChartDatum[] {
  const total = denominator ?? counts.reduce((sum, [, count]) => sum + count, 0);
  return counts.map(([label, count]) => ({
    label,
    count,
    percentage: percent(count, total)
  }));
}

function countBy<T extends string>(values: T[], labels: readonly T[]) {
  const counts = new Map<T, number>(labels.map((label) => [label, 0]));
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return labels.map((label) => [label, counts.get(label) ?? 0] as [T, number]);
}

function optionsFromJson(value: unknown) {
  return asArray(value)
    .map(asRecord)
    .map((option) => ({
      label: typeof option.label === "string" ? option.label : "",
      text: typeof option.text === "string" ? option.text : ""
    }))
    .filter((option) => option.label.trim());
}

function truncate(value: string, maxLength = MAX_SNIPPET_LENGTH) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trim()}...`;
}

function anonymizedReasoningSnippet(value: string) {
  return truncate(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\bhttps?:\/\/\S+/gi, "[link]")
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[phone]");
}

function itemStemPreview(value: string) {
  return truncate(value, 140);
}

function latestProfile(session: DashboardSession): DashboardProfile | null {
  const profiles = session.concept_unit_sessions.flatMap((conceptUnitSession) => conceptUnitSession.student_profiles);
  return [...profiles].sort((left, right) => right.created_at.getTime() - left.created_at.getTime())[0] ?? null;
}

function allResponses(session: DashboardSession) {
  return session.concept_unit_sessions.flatMap((conceptUnitSession) => conceptUnitSession.item_responses);
}

function understandingCategoryFromProfile(profile: DashboardProfile | null) {
  if (!profile) return "Unavailable / insufficient evidence" as const;

  switch (profile.integrated_diagnostic_profile) {
    case "robust_understanding_ready_for_transfer":
    case "underconfident_but_reasoning_supported":
      return "Mostly understood" as const;
    case "insufficient_evidence_for_formative_decision":
    case "low_engagement_limits_interpretability":
    case "conflicting_evidence_needs_clarification":
      return "Unavailable / insufficient evidence" as const;
    case "misconception_with_sufficient_engagement":
      return "Need more work" as const;
    default:
      return "Still developing" as const;
  }
}

function sessionReviewReasonLooksEngagementRelated(reason: string | null) {
  return /\b(engagement|incomplete reasoning|short response|interruption|insufficient response|insufficient evidence|follow-?up incomplete)\b/i.test(
    reason ?? ""
  );
}

function engagementReviewSignal(input: {
  profile: DashboardProfile | null;
  session: DashboardSession | null;
}) {
  if (!input.session || !input.profile) return ENGAGEMENT_REVIEW_INSUFFICIENT;
  if (
    input.profile.engagement_profile === "insufficient_process_evidence" ||
    input.profile.evidence_sufficiency === "insufficient"
  ) {
    return ENGAGEMENT_REVIEW_INSUFFICIENT;
  }
  if (
    input.profile.engagement_profile === "low_engagement" ||
    input.profile.integrated_diagnostic_profile === "low_engagement_limits_interpretability" ||
    (input.session.needs_review && sessionReviewReasonLooksEngagementRelated(input.session.needs_review_reason))
  ) {
    return ENGAGEMENT_REVIEW_FLAGGED;
  }
  return ENGAGEMENT_REVIEW_NO_FLAG;
}

function engagementReviewReasonLabel(input: {
  profile: DashboardProfile | null;
  session: DashboardSession | null;
}) {
  if (!input.profile) return null;
  if (input.profile.engagement_profile === "low_engagement") {
    return "Persisted low-engagement evidence profile.";
  }
  if (input.profile.integrated_diagnostic_profile === "low_engagement_limits_interpretability") {
    return "Persisted diagnostic profile says low engagement limits interpretability.";
  }
  if (input.session?.needs_review && sessionReviewReasonLooksEngagementRelated(input.session.needs_review_reason)) {
    return "Existing session review flag references engagement or evidence quality.";
  }
  return null;
}

function buildEngagementReviewReasons(attempts: CanonicalAttempt[]) {
  const counts = new Map<string, EngagementReviewReason>();

  for (const attempt of attempts) {
    if (!attempt.session) continue;
    const profile = latestProfile(attempt.session);
    const label = engagementReviewReasonLabel({ profile, session: attempt.session });
    if (!label) continue;
    const current = counts.get(label) ?? {
      label,
      count: 0,
      source: label.startsWith("Existing session") ? "session_review_flag" : "persisted_profile",
      limitations: [
        "Reason counts are teacher-review signals, not misconduct, motivation, ability, or confirmed guessing labels.",
        "Profile evidence is persisted by the assessment workflow; this dashboard does not infer a final engagement status from one timing value."
      ]
    } satisfies EngagementReviewReason;
    counts.set(label, { ...current, count: current.count + 1 });
  }

  return [...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function dashboardStatus(session: DashboardSession | null) {
  if (!session) return "Not started" as const;
  if (session.status === "completed" || session.current_phase === "session_completed") {
    return "Completed" as const;
  }
  if (session.status === "student_exited" || session.current_phase === "student_exited") {
    return "Exited/terminal incomplete" as const;
  }
  if (session.status === "active" || session.status === "paused" || session.status === "not_started") {
    return "In progress" as const;
  }
  return "Unavailable" as const;
}

function participationStatus(session: DashboardSession | null) {
  if (!session) return "Not started" as const;
  if (session.status === "completed" || session.current_phase === "session_completed") {
    return "Completed" as const;
  }
  return "Started not completed" as const;
}

function confidenceLabel(value: string | null) {
  if (value === "low") return "Low";
  if (value === "medium") return "Medium";
  if (value === "high") return "High";
  return "Not recorded";
}

function canonicalAttempts(input: {
  eligible_student_keys: string[];
  sessions: DashboardSession[];
}): CanonicalAttempt[] {
  const sessionsByStudent = new Map<string, DashboardSession[]>();
  for (const session of input.sessions) {
    const current = sessionsByStudent.get(session.user.user_id) ?? [];
    current.push(session);
    sessionsByStudent.set(session.user.user_id, current);
  }

  return input.eligible_student_keys.map((studentKey) => {
    const latest = [...(sessionsByStudent.get(studentKey) ?? [])].sort((left, right) => {
      if (right.attempt_number !== left.attempt_number) return right.attempt_number - left.attempt_number;
      const updatedDelta = right.updated_at.getTime() - left.updated_at.getTime();
      if (updatedDelta !== 0) return updatedDelta;
      return right.created_at.getTime() - left.created_at.getTime();
    })[0] ?? null;

    return { student_key: studentKey, session: latest };
  });
}

function canonicalResponses(attempts: CanonicalAttempt[], assessmentPublicId: string) {
  const responses: CanonicalResponse[] = [];
  for (const attempt of attempts) {
    if (!attempt.session) continue;
    const assessmentSnapshotPublicId = `${assessmentPublicId}:session:${attempt.session.session_public_id}`;
    for (const response of allResponses(attempt.session)) {
      responses.push({
        student_key: attempt.student_key,
        session_public_id: attempt.session.session_public_id,
        assessment_snapshot_public_id: assessmentSnapshotPublicId,
        response
      });
    }
  }
  return responses;
}

function itemSnapshotRecord(response: DashboardItemResponse) {
  return asRecord(response.item_snapshot);
}

function itemSnapshotPublicId(response: DashboardItemResponse) {
  const snapshot = itemSnapshotRecord(response);
  const itemPublicId =
    typeof snapshot.item_public_id === "string" && snapshot.item_public_id.trim()
      ? snapshot.item_public_id.trim()
      : response.item.item_public_id;
  return `${itemPublicId}:v${response.item_version_snapshot}`;
}

function currentItemSnapshotPublicId(item: DashboardItem) {
  return `${item.item_public_id}:v${item.version}`;
}

function responseItemPublicId(response: DashboardItemResponse) {
  const snapshot = itemSnapshotRecord(response);
  return typeof snapshot.item_public_id === "string" && snapshot.item_public_id.trim()
    ? snapshot.item_public_id.trim()
    : response.item.item_public_id;
}

function responseItemOrder(response: DashboardItemResponse) {
  const snapshot = itemSnapshotRecord(response);
  return typeof snapshot.item_order === "number" ? snapshot.item_order : response.item.item_order;
}

function responseItemStem(response: DashboardItemResponse) {
  const snapshot = itemSnapshotRecord(response);
  return typeof snapshot.item_stem === "string" && snapshot.item_stem.trim()
    ? snapshot.item_stem
    : response.item.item_stem;
}

function responseItemOptions(response: DashboardItemResponse) {
  const snapshot = itemSnapshotRecord(response);
  return snapshot.options ?? response.item.options;
}

function diagnosticContextSummary(administrationRules: unknown) {
  const metadata = readTeacherItemMetadata(administrationRules);
  const parts = [
    metadata.item_diagnostic_value_note,
    metadata.plain_language_distractor_diagnostic_notes,
    metadata.expected_reasoning_note
  ]
    .filter((entry) => entry && entry.trim())
    .map((entry) => truncate(entry, 220));

  return parts[0] ?? null;
}

function reasoningQualitySummary(responses: DashboardItemResponse[]) {
  if (responses.length === 0) return "No response evidence recorded yet.";
  const withReasoning = responses.filter((response) => response.reasoning_text?.trim()).length;
  const substantial = responses.filter((response) => (response.reasoning_text?.trim().length ?? 0) >= 60).length;
  return `${withReasoning}/${responses.length} responses include reasoning; ${substantial}/${responses.length} include at least 60 characters.`;
}

function normalizeReasoning(value: string | null): string | null {
  const clean = (value ?? "")
    .toLowerCase()
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, " ")
    .replace(/\bhttps?:\/\/\S+/g, " ")
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(i think|i think that|because|my reason is|the answer is)\s+/u, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return null;
  if (clean.split(/\s+/).length < 4) return null;
  if (clean.length < 18) return null;
  return clean.slice(0, 400);
}

function patternReasoningLabel(value: string) {
  if (!value) return "similar missing or very short reasoning";
  const words = value.split(/\s+/).slice(0, 12).join(" ");
  return words || "similar reasoning";
}

function buildItemDiagnostics(items: DashboardItem[], responses: CanonicalResponse[]) {
  const itemMap = new Map<string, ItemAccumulator>();
  for (const item of items) {
    itemMap.set(currentItemSnapshotPublicId(item), {
      item_public_id: item.item_public_id,
      item_snapshot_public_id: currentItemSnapshotPublicId(item),
      assessment_snapshot_public_ids: new Set(),
      item_version: item.version,
      item_order: item.item_order,
      item_stem: item.item_stem,
      options: item.options,
      administration_rules: item.administration_rules,
      responses: []
    });
  }

  for (const canonicalResponse of responses) {
    const response = canonicalResponse.response;
    const key = itemSnapshotPublicId(response);
    const current = itemMap.get(key) ?? {
      item_public_id: responseItemPublicId(response),
      item_snapshot_public_id: key,
      assessment_snapshot_public_ids: new Set<string>(),
      item_version: response.item_version_snapshot,
      item_order: responseItemOrder(response),
      item_stem: responseItemStem(response),
      options: responseItemOptions(response),
      administration_rules: null,
      responses: []
    };
    current.assessment_snapshot_public_ids.add(canonicalResponse.assessment_snapshot_public_id);
    current.responses.push(canonicalResponse);
    itemMap.set(key, current);
  }

  return [...itemMap.values()].map((entry) => {
    const responses = entry.responses.map((canonicalResponse) => canonicalResponse.response);
    const optionLabels = optionsFromJson(entry.options).map((option) => option.label);
    const selectedOptions = responses.map((response) => response.selected_option ?? "Not recorded");
    const optionCounts = optionLabels.map((label) => [
      label,
      selectedOptions.filter((selected) => selected === label).length
    ] as [string, number]);
    const selectedOutsideSnapshot = selectedOptions.filter(
      (selected) => selected !== "Not recorded" && !optionLabels.includes(selected)
    );
    for (const selected of [...new Set(selectedOutsideSnapshot)]) {
      optionCounts.push([`${selected} (not in administered option set)`, selectedOutsideSnapshot.filter((value) => value === selected).length]);
    }
    const missingCount = selectedOptions.filter((selected) => selected === "Not recorded").length;
    if (missingCount > 0) optionCounts.push(["Not recorded", missingCount]);

    const correct = responses.filter((response) => response.correctness === "correct").length;
    const incorrect = responses.filter((response) => response.correctness === "incorrect").length;

    return {
      item_public_id: entry.item_public_id,
      item_snapshot_public_id: entry.item_snapshot_public_id,
      assessment_snapshot_public_ids: [...entry.assessment_snapshot_public_ids].sort(),
      item_version: entry.item_version,
      item_order: entry.item_order,
      item_stem_preview: itemStemPreview(entry.item_stem),
      response_count: responses.length,
      correct_count: correct,
      incorrect_count: incorrect,
      correct_percentage: percent(correct, responses.length),
      incorrect_percentage: percent(incorrect, responses.length),
      option_distribution: chart(optionCounts, responses.length),
      confidence_distribution: chart(
        countBy(
          responses.map((response) => confidenceLabel(response.confidence_rating)),
          ["Low", "Medium", "High", "Not recorded"] as const
        ),
        responses.length
      ),
      reasoning_quality_summary: reasoningQualitySummary(responses),
      teacher_diagnostic_context_summary: diagnosticContextSummary(entry.administration_rules)
    } satisfies ItemDiagnosticSummary;
  });
}

function buildCandidatePatterns(responses: CanonicalResponse[]) {
  const patternMap = new Map<string, PatternAccumulator>();

  for (const canonicalResponse of responses) {
    const response = canonicalResponse.response;
    if (response.correctness !== "incorrect" || !response.selected_option) continue;
    if (response.confidence_rating !== "medium" && response.confidence_rating !== "high") continue;

    const reasoningKey = normalizeReasoning(response.reasoning_text);
    if (!reasoningKey) continue;

    const snapshotPublicId = itemSnapshotPublicId(response);
    const key = `${snapshotPublicId}:${response.selected_option}:${reasoningKey}`;
    const current = patternMap.get(key) ?? {
      item_public_id: responseItemPublicId(response),
      item_snapshot_public_id: snapshotPublicId,
      item_order: responseItemOrder(response),
      selected_option: response.selected_option,
      reasoning_key: reasoningKey,
      reasoning_group_label: patternReasoningLabel(reasoningKey),
      responses: [],
      student_keys: new Set<string>()
    };
    current.responses.push(canonicalResponse);
    current.student_keys.add(canonicalResponse.student_key);
    patternMap.set(key, current);
  }

  return [...patternMap.values()]
    .filter((entry) => entry.student_keys.size >= CANDIDATE_PATTERN_THRESHOLD)
    .sort((left, right) => right.student_keys.size - left.student_keys.size || left.item_order - right.item_order)
    .map((entry, index) => {
      const mediumCount = entry.responses.filter((entryResponse) => entryResponse.response.confidence_rating === "medium").length;
      const highCount = entry.responses.filter((entryResponse) => entryResponse.response.confidence_rating === "high").length;
      const snippets = [...new Set(entry.responses
        .map((entryResponse) => entryResponse.response.reasoning_text?.trim() ?? "")
        .filter(Boolean)
        .map((reasoning) => anonymizedReasoningSnippet(reasoning)))]
        .slice(0, MAX_REASONING_SNIPPETS);

      return {
        pattern_id: `candidate-${index + 1}`,
        item_public_id: entry.item_public_id,
        item_snapshot_public_id: entry.item_snapshot_public_id,
        item_order: entry.item_order,
        option_selected: entry.selected_option,
        unique_student_count: entry.student_keys.size,
        response_count: entry.responses.length,
        medium_or_high_confidence_count: entry.responses.length,
        confidence_summary: `Medium: ${mediumCount}; High: ${highCount}`,
        reasoning_group_label: entry.reasoning_group_label,
        reasoning_grouping_method: "deterministic exact normalized reasoning after removing common opening phrases",
        threshold_unique_student_count: CANDIDATE_PATTERN_THRESHOLD,
        limitations: [
          "Exact normalized text grouping is conservative and does not claim semantic equivalence.",
          "One canonical latest-attempt response per unique student is used for threshold counting."
        ],
        representative_reasoning_snippets: snippets,
        review_note:
          "Candidate response pattern for teacher review only. This is repeated response evidence, not a confirmed misconception."
      } satisfies CandidateMisconceptionPattern;
    });
}

function csvSafe(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function dashboardCsvRows(dashboard: TeacherAssessmentDashboard) {
  const rows: Array<Record<string, unknown>> = [];
  const assessmentId = dashboard.selected_assessment_public_id ?? "";
  const assessmentTitle = dashboard.selected_assessment?.title ?? "";

  rows.push({
    row_type: "dashboard_metadata",
    assessment_public_id: assessmentId,
    assessment_title: assessmentTitle,
    dashboard_version: dashboard.dashboard_version,
    eligible_student_count: dashboard.eligible_student_count,
    eligibility_basis: dashboard.eligibility_basis,
    attempt_policy: dashboard.attempt_policy.policy,
    attempt_policy_description: dashboard.attempt_policy.description,
    has_student_data: dashboard.has_student_data,
    candidate_pattern_threshold: dashboard.candidate_pattern_threshold
  });

  for (const [metric, value] of Object.entries(dashboard.summary_cards)) {
    rows.push({
      row_type: "summary_card",
      assessment_public_id: assessmentId,
      assessment_title: assessmentTitle,
      label: metric,
      value
    });
  }

  rows.push({
    row_type: "time_indicator",
    assessment_public_id: assessmentId,
    assessment_title: assessmentTitle,
    time_metric_type: dashboard.time_indicator.time_metric_type,
    average_time_ms: dashboard.time_indicator.average_time_ms,
    median_time_ms: dashboard.time_indicator.median_time_ms,
    average_minutes: dashboard.time_indicator.average_minutes,
    median_minutes: dashboard.time_indicator.median_minutes,
    sample_size: dashboard.time_indicator.sample_size,
    unavailable_count: dashboard.time_indicator.unavailable_count,
    limitations: dashboard.time_indicator.limitations.join(" | ")
  });

  for (const row of dashboard.status_distribution) {
    rows.push({ row_type: "participation_status", assessment_public_id: assessmentId, assessment_title: assessmentTitle, ...row });
  }
  for (const row of dashboard.detailed_status_distribution) {
    rows.push({ row_type: "detailed_status_distribution", assessment_public_id: assessmentId, assessment_title: assessmentTitle, ...row });
  }
  for (const row of dashboard.understanding_distribution) {
    rows.push({ row_type: "assessment_specific_understanding", assessment_public_id: assessmentId, assessment_title: assessmentTitle, ...row });
  }
  for (const row of dashboard.engagement_distribution) {
    rows.push({ row_type: "engagement_review_signals", assessment_public_id: assessmentId, assessment_title: assessmentTitle, ...row });
  }
  for (const reason of dashboard.engagement_review_reasons) {
    rows.push({
      row_type: "engagement_review_reason",
      assessment_public_id: assessmentId,
      assessment_title: assessmentTitle,
      label: reason.label,
      count: reason.count,
      source: reason.source,
      limitations: reason.limitations.join(" | ")
    });
  }
  for (const item of dashboard.item_diagnostics) {
    rows.push({
      row_type: "item_diagnostic_summary",
      assessment_public_id: assessmentId,
      assessment_title: assessmentTitle,
      item_public_id: item.item_public_id,
      item_snapshot_public_id: item.item_snapshot_public_id,
      assessment_snapshot_public_ids: item.assessment_snapshot_public_ids.join(";"),
      item_version: item.item_version,
      item_order: item.item_order,
      item_stem_preview: item.item_stem_preview,
      response_count: item.response_count,
      correct_count: item.correct_count,
      incorrect_count: item.incorrect_count,
      correct_percentage: item.correct_percentage,
      incorrect_percentage: item.incorrect_percentage,
      reasoning_quality_summary: item.reasoning_quality_summary,
      teacher_diagnostic_context_summary: item.teacher_diagnostic_context_summary
    });
    for (const option of item.option_distribution) {
      rows.push({
        row_type: "item_option_distribution",
        assessment_public_id: assessmentId,
        assessment_title: assessmentTitle,
        item_public_id: item.item_public_id,
        item_snapshot_public_id: item.item_snapshot_public_id,
        item_order: item.item_order,
        label: option.label,
        count: option.count,
        percentage: option.percentage
      });
    }
    for (const confidence of item.confidence_distribution) {
      rows.push({
        row_type: "item_confidence_distribution",
        assessment_public_id: assessmentId,
        assessment_title: assessmentTitle,
        item_public_id: item.item_public_id,
        item_snapshot_public_id: item.item_snapshot_public_id,
        item_order: item.item_order,
        label: confidence.label,
        count: confidence.count,
        percentage: confidence.percentage
      });
    }
  }
  for (const pattern of dashboard.candidate_misconception_patterns) {
    rows.push({
      row_type: "candidate_misconception_pattern",
      assessment_public_id: assessmentId,
      assessment_title: assessmentTitle,
      ...pattern,
      limitations: pattern.limitations.join(" | "),
      representative_reasoning_snippets: pattern.representative_reasoning_snippets.join(" | ")
    });
  }

  return rows;
}

async function listAssessmentOptions(teacherUserDbId: string): Promise<AssessmentDashboardOption[]> {
  const assessments = await prisma.assessment.findMany({
    where: {
      created_by_user_db_id: teacherUserDbId,
      status: { not: "archived" }
    },
    select: assessmentOptionSelect,
    orderBy: [
      { status: "desc" },
      { folder_order_index: "asc" },
      { assessment_order_index: "asc" },
      { updated_at: "desc" }
    ]
  });

  return assessments.map((assessment) => ({
    assessment_public_id: assessment.assessment_public_id,
    title: assessment.title,
    status: assessment.status,
    folder_label: assessment.folder_label,
    session_count: assessment._count.assessment_sessions
  }));
}

async function eligibleStudentKeys(teacherUserDbId: string, sessions: DashboardSession[]) {
  const activeStudents = await prisma.user.findMany({
    where: {
      role: "student",
      account_status: "active",
      created_by_teacher_user_id: teacherUserDbId
    },
    select: {
      user_id: true
    }
  });

  if (activeStudents.length > 0) {
    return {
      keys: activeStudents.map((student) => student.user_id).sort(),
      basis: ELIGIBILITY_BASIS_ALL_ACTIVE_TEACHER_STUDENTS
    };
  }

  return {
    keys: [...new Set(sessions.map((session) => session.user.user_id))].sort(),
    basis: ELIGIBILITY_BASIS_SESSION_STUDENTS_ONLY
  };
}

function activeInteractionDurationMs(session: DashboardSession) {
  if (session.status !== "completed" && session.current_phase !== "session_completed") return null;
  const responseDurations = allResponses(session)
    .map((response) => response.item_response_time_ms)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (responseDurations.length === 0) return null;
  return responseDurations.reduce((total, value) => total + value, 0);
}

function elapsedWallClockDurationMs(session: DashboardSession) {
  if (session.status !== "completed" && session.current_phase !== "session_completed") return null;
  if (!session.started_at || !session.completed_at) return null;
  return Math.max(0, session.completed_at.getTime() - session.started_at.getTime());
}

function buildTimeIndicator(completedSessions: DashboardSession[]): TimeIndicator {
  const activeDurations = completedSessions
    .map(activeInteractionDurationMs)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  if (activeDurations.length > 0) {
    const averageMs = average(activeDurations);
    const medianMs = median(activeDurations);
    const unavailableCount = completedSessions.length - activeDurations.length;
    return {
      time_metric_type: "active_interaction_ms",
      average_time_ms: averageMs,
      median_time_ms: medianMs,
      average_minutes: averageMs === null ? null : minutes(averageMs),
      median_minutes: medianMs === null ? null : minutes(medianMs),
      sample_size: activeDurations.length,
      unavailable_count: unavailableCount,
      limitations: [
        "Uses summed item response durations from latest completed attempts.",
        ...(unavailableCount > 0
          ? ["Some latest completed attempts lacked active item-duration data and are excluded from the time metric."]
          : [])
      ]
    };
  }

  const elapsedDurations = completedSessions
    .map(elapsedWallClockDurationMs)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  if (elapsedDurations.length > 0) {
    const averageMs = average(elapsedDurations);
    const medianMs = median(elapsedDurations);
    return {
      time_metric_type: "elapsed_wall_clock_ms",
      average_time_ms: averageMs,
      median_time_ms: medianMs,
      average_minutes: averageMs === null ? null : minutes(averageMs),
      median_minutes: medianMs === null ? null : minutes(medianMs),
      sample_size: elapsedDurations.length,
      unavailable_count: completedSessions.length - elapsedDurations.length,
      limitations: [
        "Active interaction timing was unavailable, so this uses elapsed wall-clock time from session start to completion.",
        "Elapsed wall-clock time can include pauses or idle time."
      ]
    };
  }

  return {
    time_metric_type: "unavailable",
    average_time_ms: null,
    median_time_ms: null,
    average_minutes: null,
    median_minutes: null,
    sample_size: 0,
    unavailable_count: completedSessions.length,
    limitations: ["No completed latest attempts had usable active or elapsed timing data."]
  };
}

export async function getTeacherAssessmentDashboard(input: {
  teacher_user_db_id: string;
  assessment_public_id?: string | null;
}): Promise<TeacherAssessmentDashboard> {
  const assessments = await listAssessmentOptions(input.teacher_user_db_id);
  const selectedPublicId = input.assessment_public_id || assessments[0]?.assessment_public_id || null;

  if (!selectedPublicId) {
    return {
      dashboard_version: TEACHER_ASSESSMENT_DASHBOARD_VERSION,
      selected_assessment_public_id: null,
      assessments,
      selected_assessment: null,
      eligible_student_count: 0,
      eligibility_basis: ELIGIBILITY_BASIS_ALL_ACTIVE_TEACHER_STUDENTS,
      attempt_policy: {
        policy: ATTEMPT_POLICY_LATEST_PER_STUDENT,
        description: "One dashboard state is counted per eligible student using that student's latest attempt."
      },
      has_student_data: false,
      candidate_pattern_threshold: CANDIDATE_PATTERN_THRESHOLD,
      summary_cards: {
        total_students: 0,
        eligible_student_count: 0,
        not_started: 0,
        in_progress: 0,
        started_not_completed: 0,
        completed: 0,
        exited_terminal_incomplete: 0,
        unavailable: 0,
        flagged_for_review: 0,
        average_time_spent_minutes: null
      },
      status_distribution: [],
      detailed_status_distribution: [],
      progress_chart: [],
      understanding_distribution: [],
      engagement_distribution: [],
      engagement_review_reasons: [],
      time_indicator: {
        time_metric_type: "unavailable",
        average_time_ms: null,
        median_time_ms: null,
        average_minutes: null,
        median_minutes: null,
        sample_size: 0,
        unavailable_count: 0,
        limitations: ["No selected assessment is available."]
      },
      item_diagnostics: [],
      candidate_misconception_patterns: [],
      export_links: { dashboard_csv: null, assessment_summary_csv: null, detailed_process_bundle: null },
      notes: [
        "Create or publish a mini test to populate assessment-level diagnostic dashboard summaries."
      ]
    };
  }

  const assessment = await prisma.assessment.findFirst({
    where: {
      assessment_public_id: selectedPublicId,
      created_by_user_db_id: input.teacher_user_db_id,
      status: { not: "archived" }
    },
    select: dashboardAssessmentSelect
  });

  if (!assessment) {
    throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  }

  const sessions = await prisma.assessmentSession.findMany({
    where: {
      assessment_db_id: assessment.id,
      user: { role: "student" }
    },
    select: dashboardSessionSelect,
    orderBy: [{ updated_at: "desc" }, { created_at: "desc" }]
  });

  const eligible = await eligibleStudentKeys(input.teacher_user_db_id, sessions);
  const attempts = canonicalAttempts({
    eligible_student_keys: eligible.keys,
    sessions
  });
  const canonicalSessionCount = attempts.filter((attempt) => attempt.session).length;
  const hasStudentData = canonicalSessionCount > 0;
  const totalStudents = eligible.keys.length;
  const completedSessions = attempts
    .map((attempt) => attempt.session)
    .filter((session): session is DashboardSession => Boolean(session) && dashboardStatus(session) === "Completed");
  const flagged = attempts.filter(
    (attempt) => attempt.session?.needs_review || attempt.session?.status === "needs_review"
  ).length;
  const statusValues = attempts.map((attempt) => dashboardStatus(attempt.session));
  const participationValues = attempts.map((attempt) => participationStatus(attempt.session));
  const inProgress = statusValues.filter((status) => status === "In progress").length;
  const completed = statusValues.filter((status) => status === "Completed").length;
  const notStarted = statusValues.filter((status) => status === "Not started").length;
  const startedNotCompleted = participationValues.filter((status) => status === "Started not completed").length;
  const exitedTerminalIncomplete = statusValues.filter((status) => status === "Exited/terminal incomplete").length;
  const unavailable = statusValues.filter((status) => status === "Unavailable").length;
  const timeIndicator = buildTimeIndicator(completedSessions);

  const understandingValues = attempts.map((attempt) =>
    attempt.session ? understandingCategoryFromProfile(latestProfile(attempt.session)) : "Unavailable / insufficient evidence"
  );
  const engagementValues = attempts.map((attempt) =>
    engagementReviewSignal({
      profile: attempt.session ? latestProfile(attempt.session) : null,
      session: attempt.session
    })
  );
  const engagementReviewReasons = buildEngagementReviewReasons(attempts);
  const items = assessment.concept_units.flatMap((conceptUnit) => conceptUnit.items);
  const responses = canonicalResponses(attempts, assessment.assessment_public_id);
  const statusDistribution = hasStudentData
    ? chart(
        countBy(
          participationValues,
          ["Not started", "Started not completed", "Completed"] as const
        ),
        totalStudents
      )
    : [];
  const detailedStatusDistribution = hasStudentData
    ? chart(
        countBy(
          statusValues,
          ["Not started", "In progress", "Completed", "Exited/terminal incomplete", "Unavailable"] as const
        ),
        totalStudents
      )
    : [];
  const progressChart = hasStudentData
    ? chart(
        [
          ["Started", canonicalSessionCount],
          ["Not started", notStarted]
        ],
        totalStudents
      )
    : [];

  return {
    dashboard_version: TEACHER_ASSESSMENT_DASHBOARD_VERSION,
    selected_assessment_public_id: assessment.assessment_public_id,
    assessments,
    selected_assessment: {
      assessment_public_id: assessment.assessment_public_id,
      title: assessment.title,
      description: assessment.description,
      diagnostic_focus: assessment.diagnostic_focus,
      folder_label: assessment.folder_label,
      status: assessment.status,
      release_at: iso(assessment.release_at),
      close_at: iso(assessment.close_at)
    },
    eligible_student_count: totalStudents,
    eligibility_basis: eligible.basis,
    attempt_policy: {
      policy: ATTEMPT_POLICY_LATEST_PER_STUDENT,
      description: "One dashboard state is counted per eligible student using that student's latest attempt."
    },
    has_student_data: hasStudentData,
    candidate_pattern_threshold: CANDIDATE_PATTERN_THRESHOLD,
    summary_cards: {
      total_students: totalStudents,
      eligible_student_count: totalStudents,
      not_started: notStarted,
      in_progress: inProgress,
      started_not_completed: startedNotCompleted,
      completed,
      exited_terminal_incomplete: exitedTerminalIncomplete,
      unavailable,
      flagged_for_review: flagged,
      average_time_spent_minutes: timeIndicator.average_minutes
    },
    status_distribution: statusDistribution,
    detailed_status_distribution: detailedStatusDistribution,
    progress_chart: progressChart,
    understanding_distribution: chart(
      countBy(
        understandingValues,
        ["Need more work", "Still developing", "Mostly understood", "Unavailable / insufficient evidence"] as const
      ),
      totalStudents
    ),
    engagement_distribution: chart(
      countBy(
        engagementValues,
        [
          ENGAGEMENT_REVIEW_NO_FLAG,
          ENGAGEMENT_REVIEW_FLAGGED,
          ENGAGEMENT_REVIEW_INSUFFICIENT
        ] as const
      ),
      totalStudents
    ),
    engagement_review_reasons: engagementReviewReasons,
    time_indicator: timeIndicator,
    item_diagnostics: buildItemDiagnostics(items, responses),
    candidate_misconception_patterns: buildCandidatePatterns(responses),
    export_links: {
      dashboard_csv: `/api/teacher/dashboard/export?assessment_public_id=${encodeURIComponent(assessment.assessment_public_id)}`,
      assessment_summary_csv: `/api/teacher/data-explorer/assessments/${encodeURIComponent(assessment.assessment_public_id)}/csv`,
      detailed_process_bundle: `/api/teacher/data-explorer/assessments/${encodeURIComponent(assessment.assessment_public_id)}/detailed-csv`
    },
    notes: [
      totalStudents === 0
        ? "No eligible student denominator is available for this assessment."
        : `Eligible student denominator uses ${totalStudents} ${eligible.basis === ELIGIBILITY_BASIS_ALL_ACTIVE_TEACHER_STUDENTS ? "active student accounts created by this teacher; this system does not currently model assessment-specific assigned rosters." : "students with sessions for this assessment because no teacher-created active roster was found."}`,
      hasStudentData
        ? "Status, understanding, engagement, item, and candidate-pattern summaries use one latest attempt per eligible student."
        : "No student data are available for this assessment.",
      "Dashboard categories are assessment-specific diagnostic signals, not stable learner traits.",
      "Understanding categories come from persisted profile outputs for the selected assessment; missing or insufficient profile evidence remains unavailable.",
      "Engagement review signals come from persisted profile engagement evidence or defined engagement/evidence-quality review flags; missing profile evidence is counted as insufficient evidence, not as no concern.",
      "Flagged for review is an overlapping review indicator and is not part of the mutually exclusive status distribution.",
      ...timeIndicator.limitations,
      totalStudents < CANDIDATE_PATTERN_THRESHOLD
        ? `Candidate response patterns cannot reach the default threshold of ${CANDIDATE_PATTERN_THRESHOLD} unique students with the current denominator.`
        : `Candidate response patterns require at least ${CANDIDATE_PATTERN_THRESHOLD} unique students with the same administered item snapshot, same wrong option, medium/high confidence, and exact normalized reasoning.`
    ]
  };
}

export async function downloadTeacherAssessmentDashboardCsv(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const dashboard = await getTeacherAssessmentDashboard(input);
  const rows = dashboardCsvRows(dashboard);
  const columns = [
    "row_type",
    "assessment_public_id",
    "assessment_title",
    "dashboard_version",
    "eligible_student_count",
    "eligibility_basis",
    "attempt_policy",
    "attempt_policy_description",
    "has_student_data",
    "candidate_pattern_threshold",
    "source",
    "label",
    "value",
    "count",
    "percentage",
    "time_metric_type",
    "average_time_ms",
    "median_time_ms",
    "average_minutes",
    "median_minutes",
    "sample_size",
    "unavailable_count",
    "limitations",
    "item_public_id",
    "item_snapshot_public_id",
    "assessment_snapshot_public_ids",
    "item_version",
    "item_order",
    "item_stem_preview",
    "response_count",
    "correct_count",
    "incorrect_count",
    "correct_percentage",
    "incorrect_percentage",
    "reasoning_quality_summary",
    "teacher_diagnostic_context_summary",
    "pattern_id",
    "option_selected",
    "unique_student_count",
    "medium_or_high_confidence_count",
    "confidence_summary",
    "reasoning_group_label",
    "reasoning_grouping_method",
    "threshold_unique_student_count",
    "representative_reasoning_snippets",
    "review_note"
  ];

  return {
    content_type: "text/csv; charset=utf-8",
    file_name: `assessment-dashboard-${input.assessment_public_id}.csv`,
    content: stringify(
      rows.map((row) => Object.fromEntries(columns.map((column) => [column, csvSafe(row[column])]))),
      { header: true, columns }
    )
  };
}
