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
          status: true
        }
      }
    }
  }
} satisfies Prisma.AssessmentSelect;

const dashboardSessionSelect = {
  id: true,
  session_public_id: true,
  status: true,
  current_phase: true,
  needs_review: true,
  needs_review_reason: true,
  started_at: true,
  last_activity_at: true,
  completed_at: true,
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
          correctness: true,
          reasoning_text: true,
          confidence_rating: true,
          item_response_time_ms: true,
          item_started_at: true,
          item_submitted_at: true,
          revision_count: true,
          item: {
            select: {
              item_public_id: true,
              item_order: true
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
          ability_profile: true,
          engagement_profile: true,
          evidence_sufficiency: true,
          reasoning_quality_summary: true,
          engagement_summary: true,
          item_level_evidence: true,
          created_at: true
        },
        orderBy: [{ created_at: "desc" }],
        take: 1
      }
    }
  },
  process_events: {
    select: {
      event_type: true,
      event_category: true,
      event_source: true,
      pause_duration_ms: true,
      visibility_duration_ms: true,
      occurred_at: true,
      created_at: true
    },
    orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }]
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
  summary_cards: AssessmentDashboardSummaryCards;
  status_distribution: ChartDatum[];
  progress_chart: ChartDatum[];
  understanding_distribution: ChartDatum[];
  engagement_distribution: ChartDatum[];
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
  not_started: number;
  in_progress: number;
  completed: number;
  flagged_for_review: number;
  average_time_spent_minutes: number | null;
};

export type ChartDatum = {
  label: string;
  count: number;
  percentage: number;
};

export type TimeIndicator = {
  average_minutes: number | null;
  median_minutes: number | null;
  sample_size: number;
};

export type ItemDiagnosticSummary = {
  item_public_id: string;
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
  item_order: number;
  option_selected: string;
  response_count: number;
  medium_or_high_confidence_count: number;
  confidence_summary: string;
  reasoning_group_label: string;
  reasoning_grouping_method: string;
  representative_reasoning_snippets: string[];
  review_note: string;
};

type ItemAccumulator = {
  item: DashboardItem;
  responses: DashboardItemResponse[];
};

type PatternAccumulator = {
  item: DashboardItem;
  selected_option: string;
  reasoning_key: string;
  reasoning_group_label: string;
  responses: DashboardItemResponse[];
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

function sessionDurationMinutes(session: DashboardSession) {
  if (!session.started_at) return null;
  const end = session.completed_at ?? session.last_activity_at;
  if (!end) return null;
  const durationMs = Math.max(0, end.getTime() - session.started_at.getTime());
  return minutes(durationMs);
}

function latestProfile(session: DashboardSession): DashboardProfile | null {
  const profiles = session.concept_unit_sessions.flatMap((conceptUnitSession) => conceptUnitSession.student_profiles);
  return [...profiles].sort((left, right) => right.created_at.getTime() - left.created_at.getTime())[0] ?? null;
}

function allResponses(session: DashboardSession) {
  return session.concept_unit_sessions.flatMap((conceptUnitSession) => conceptUnitSession.item_responses);
}

function understandingCategoryFromProfile(profile: DashboardProfile | null) {
  if (!profile) return null;

  switch (profile.integrated_diagnostic_profile) {
    case "robust_understanding_ready_for_transfer":
    case "underconfident_but_reasoning_supported":
      return "Mostly understood" as const;
    case "insufficient_evidence_for_formative_decision":
    case "low_engagement_limits_interpretability":
      return "Need more work" as const;
    default:
      return "Still developing" as const;
  }
}

function understandingCategoryFromResponses(responses: DashboardItemResponse[]) {
  const scored = responses.filter((response) => response.correctness === "correct" || response.correctness === "incorrect");
  if (scored.length === 0) return null;
  const correct = scored.filter((response) => response.correctness === "correct").length;
  const correctRate = correct / scored.length;
  const averageReasoningLength =
    scored.reduce((total, response) => total + (response.reasoning_text?.trim().length ?? 0), 0) / scored.length;

  if (correctRate >= 0.67 && averageReasoningLength >= 40) return "Mostly understood" as const;
  if (correctRate > 0 || averageReasoningLength >= 25) return "Still developing" as const;
  return "Need more work" as const;
}

function engagementSignal(session: DashboardSession) {
  const responses = allResponses(session);
  if (responses.length === 0) return null;

  const submittedResponses = responses.filter((response) => response.item_submitted_at || response.selected_option);
  const averageReasoningLength =
    submittedResponses.length === 0
      ? 0
      : submittedResponses.reduce((total, response) => total + (response.reasoning_text?.trim().length ?? 0), 0) /
        submittedResponses.length;
  const processEventCount = session.process_events.length;
  const revisionCount = submittedResponses.reduce((total, response) => total + response.revision_count, 0);
  const responsePackageCount = session.concept_unit_sessions.reduce(
    (total, conceptUnitSession) => total + conceptUnitSession.response_packages.length,
    0
  );
  const averageItemTimeMs = average(
    submittedResponses
      .map((response) => response.item_response_time_ms)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  );

  if (
    submittedResponses.length >= 3 &&
    responsePackageCount > 0 &&
    averageReasoningLength >= 80 &&
    processEventCount >= submittedResponses.length * 4
  ) {
    return "High engagement" as const;
  }

  if (
    submittedResponses.length < 2 ||
    (averageReasoningLength < 20 && (averageItemTimeMs ?? 0) > 0 && (averageItemTimeMs ?? 0) < 12_000)
  ) {
    return "Low engagement" as const;
  }

  if (revisionCount > 0 && averageReasoningLength >= 50) {
    return "High engagement" as const;
  }

  return "Moderate engagement" as const;
}

function dashboardStatus(session: DashboardSession) {
  if (session.status === "needs_review" || session.needs_review) return "Flagged for review" as const;
  if (session.status === "completed") return "Completed" as const;
  return "In progress" as const;
}

function confidenceLabel(value: string | null) {
  if (value === "low") return "Low";
  if (value === "medium") return "Medium";
  if (value === "high") return "High";
  return "Not recorded";
}

function diagnosticContextSummary(item: DashboardItem) {
  const metadata = readTeacherItemMetadata(item.administration_rules);
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

function normalizeReasoning(value: string | null) {
  const clean = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.slice(0, 160);
}

function patternReasoningLabel(value: string) {
  if (!value) return "similar missing or very short reasoning";
  const words = value.split(/\s+/).slice(0, 12).join(" ");
  return words || "similar reasoning";
}

function buildItemDiagnostics(items: DashboardItem[], sessions: DashboardSession[]) {
  const itemMap = new Map<string, ItemAccumulator>(
    items.map((item) => [item.item_public_id, { item, responses: [] }])
  );

  for (const session of sessions) {
    for (const response of allResponses(session)) {
      const entry = itemMap.get(response.item.item_public_id);
      if (entry) entry.responses.push(response);
    }
  }

  return [...itemMap.values()].map(({ item, responses }) => {
    const optionLabels = optionsFromJson(item.options).map((option) => option.label);
    const selectedOptions = responses.map((response) => response.selected_option ?? "Not recorded");
    const optionCounts = optionLabels.map((label) => [
      label,
      selectedOptions.filter((selected) => selected === label).length
    ] as [string, number]);
    const missingCount = selectedOptions.filter((selected) => selected === "Not recorded").length;
    if (missingCount > 0) optionCounts.push(["Not recorded", missingCount]);

    const correct = responses.filter((response) => response.correctness === "correct").length;
    const incorrect = responses.filter((response) => response.correctness === "incorrect").length;

    return {
      item_public_id: item.item_public_id,
      item_order: item.item_order,
      item_stem_preview: itemStemPreview(item.item_stem),
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
      teacher_diagnostic_context_summary: diagnosticContextSummary(item)
    } satisfies ItemDiagnosticSummary;
  });
}

function buildCandidatePatterns(items: DashboardItem[], sessions: DashboardSession[]) {
  const itemMap = new Map(items.map((item) => [item.item_public_id, item]));
  const patternMap = new Map<string, PatternAccumulator>();

  for (const session of sessions) {
    for (const response of allResponses(session)) {
      const item = itemMap.get(response.item.item_public_id);
      if (!item || response.correctness !== "incorrect" || !response.selected_option) continue;
      if (response.confidence_rating !== "medium" && response.confidence_rating !== "high") continue;

      const reasoningKey = normalizeReasoning(response.reasoning_text);
      const key = `${item.item_public_id}:${response.selected_option}:${reasoningKey}`;
      const current = patternMap.get(key) ?? {
        item,
        selected_option: response.selected_option,
        reasoning_key: reasoningKey,
        reasoning_group_label: patternReasoningLabel(reasoningKey),
        responses: []
      };
      current.responses.push(response);
      patternMap.set(key, current);
    }
  }

  return [...patternMap.values()]
    .filter((entry) => entry.responses.length >= CANDIDATE_PATTERN_THRESHOLD)
    .sort((left, right) => right.responses.length - left.responses.length || left.item.item_order - right.item.item_order)
    .map((entry, index) => {
      const mediumCount = entry.responses.filter((response) => response.confidence_rating === "medium").length;
      const highCount = entry.responses.filter((response) => response.confidence_rating === "high").length;
      const snippets = [...new Set(entry.responses
        .map((response) => response.reasoning_text?.trim() ?? "")
        .filter(Boolean)
        .map((reasoning) => anonymizedReasoningSnippet(reasoning)))]
        .slice(0, MAX_REASONING_SNIPPETS);

      return {
        pattern_id: `candidate-${index + 1}`,
        item_public_id: entry.item.item_public_id,
        item_order: entry.item.item_order,
        option_selected: entry.selected_option,
        response_count: entry.responses.length,
        medium_or_high_confidence_count: entry.responses.length,
        confidence_summary: `Medium: ${mediumCount}; High: ${highCount}`,
        reasoning_group_label: entry.reasoning_group_label,
        reasoning_grouping_method: "deterministic exact normalized reasoning-prefix grouping",
        representative_reasoning_snippets: snippets,
        review_note:
          "Candidate pattern only. This is repeated response evidence for teacher review, not a confirmed misconception."
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

  for (const [metric, value] of Object.entries(dashboard.summary_cards)) {
    rows.push({
      row_type: "summary_card",
      assessment_public_id: assessmentId,
      assessment_title: assessmentTitle,
      label: metric,
      value
    });
  }

  for (const row of dashboard.status_distribution) {
    rows.push({ row_type: "status_distribution", assessment_public_id: assessmentId, assessment_title: assessmentTitle, ...row });
  }
  for (const row of dashboard.understanding_distribution) {
    rows.push({ row_type: "assessment_specific_understanding", assessment_public_id: assessmentId, assessment_title: assessmentTitle, ...row });
  }
  for (const row of dashboard.engagement_distribution) {
    rows.push({ row_type: "engagement_signals", assessment_public_id: assessmentId, assessment_title: assessmentTitle, ...row });
  }
  for (const item of dashboard.item_diagnostics) {
    rows.push({
      row_type: "item_diagnostic_summary",
      assessment_public_id: assessmentId,
      assessment_title: assessmentTitle,
      item_public_id: item.item_public_id,
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

async function teacherStudentCount(teacherUserDbId: string, sessions: DashboardSession[]) {
  const activeStudents = await prisma.user.count({
    where: {
      role: "student",
      account_status: "active",
      created_by_teacher_user_id: teacherUserDbId
    }
  });

  if (activeStudents > 0) return activeStudents;
  return new Set(sessions.map((session) => session.user.user_id)).size;
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
      summary_cards: {
        total_students: 0,
        not_started: 0,
        in_progress: 0,
        completed: 0,
        flagged_for_review: 0,
        average_time_spent_minutes: null
      },
      status_distribution: chart([["Not started", 0], ["In progress", 0], ["Completed", 0], ["Flagged for review", 0]]),
      progress_chart: chart([["Started", 0], ["Not started", 0]]),
      understanding_distribution: chart([["Need more work", 0], ["Still developing", 0], ["Mostly understood", 0]]),
      engagement_distribution: chart([["Low engagement", 0], ["Moderate engagement", 0], ["High engagement", 0]]),
      time_indicator: { average_minutes: null, median_minutes: null, sample_size: 0 },
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

  const totalStudents = await teacherStudentCount(input.teacher_user_db_id, sessions);
  const sessionStudentCount = new Set(sessions.map((session) => session.user.user_id)).size;
  const completed = sessions.filter((session) => session.status === "completed").length;
  const flagged = sessions.filter((session) => session.status === "needs_review" || session.needs_review).length;
  const statusValues = sessions.map(dashboardStatus);
  const inProgress = statusValues.filter((status) => status === "In progress").length;
  const notStarted = Math.max(0, totalStudents - sessionStudentCount);
  const durations = sessions
    .map(sessionDurationMinutes)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const averageTime = average(durations);

  const understandingValues = sessions
    .map((session) => understandingCategoryFromProfile(latestProfile(session)) ?? understandingCategoryFromResponses(allResponses(session)))
    .filter((value): value is "Need more work" | "Still developing" | "Mostly understood" => Boolean(value));
  const engagementValues = sessions
    .map(engagementSignal)
    .filter((value): value is "Low engagement" | "Moderate engagement" | "High engagement" => Boolean(value));
  const items = assessment.concept_units.flatMap((conceptUnit) => conceptUnit.items);

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
    summary_cards: {
      total_students: totalStudents,
      not_started: notStarted,
      in_progress: inProgress,
      completed,
      flagged_for_review: flagged,
      average_time_spent_minutes: averageTime
    },
    status_distribution: chart(
      [
        ["Not started", notStarted],
        ["In progress", inProgress],
        ["Completed", statusValues.filter((status) => status === "Completed").length],
        ["Flagged for review", statusValues.filter((status) => status === "Flagged for review").length]
      ],
      Math.max(totalStudents, sessions.length)
    ),
    progress_chart: chart(
      [
        ["Started", sessionStudentCount],
        ["Not started", notStarted]
      ],
      Math.max(totalStudents, sessionStudentCount + notStarted)
    ),
    understanding_distribution: chart(
      countBy(understandingValues, ["Need more work", "Still developing", "Mostly understood"] as const)
    ),
    engagement_distribution: chart(
      countBy(engagementValues, ["Low engagement", "Moderate engagement", "High engagement"] as const)
    ),
    time_indicator: {
      average_minutes: averageTime,
      median_minutes: median(durations),
      sample_size: durations.length
    },
    item_diagnostics: buildItemDiagnostics(items, sessions),
    candidate_misconception_patterns: buildCandidatePatterns(items, sessions),
    export_links: {
      dashboard_csv: `/api/teacher/dashboard/export?assessment_public_id=${encodeURIComponent(assessment.assessment_public_id)}`,
      assessment_summary_csv: `/api/teacher/data-explorer/assessments/${encodeURIComponent(assessment.assessment_public_id)}/csv`,
      detailed_process_bundle: `/api/teacher/data-explorer/assessments/${encodeURIComponent(assessment.assessment_public_id)}/detailed-csv`
    },
    notes: [
      "Dashboard categories are assessment-specific diagnostic signals, not stable learner traits.",
      "Engagement signals are deterministic process and response indicators, not misconduct or motivation labels.",
      `Candidate misconception patterns require at least ${CANDIDATE_PATTERN_THRESHOLD} repeated wrong-option, medium/high-confidence responses with normalized repeated reasoning.`
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
    "label",
    "value",
    "count",
    "percentage",
    "item_public_id",
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
    "medium_or_high_confidence_count",
    "confidence_summary",
    "reasoning_group_label",
    "reasoning_grouping_method",
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
