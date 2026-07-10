import { stringify } from "csv-stringify/sync";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildAbilityEvidencePacketForSession } from "@/lib/services/student-assessment/ability-evidence";
import { projectStoredStudentProfileIntegration } from "@/lib/services/student-assessment/profile-integration";
import { buildEngagementProcessFeatureRows } from "@/lib/services/teacher-review/engagement-process-features";
import { buildTurnResponseLatencyRows } from "@/lib/services/teacher-review/turn-response-latencies";
import { ContentServiceError } from "@/lib/services/content/errors";
import {
  buildExportSourceIdentity,
  EXPORT_SOURCE_COLUMNS,
  sourceIdentityRow,
  type ExportSourceIdentity
} from "@/lib/services/teacher-research-export/source-identity";

export const TEACHER_SIMPLE_CSV_EXPORT_VERSION = "teacher-simple-csv-export-v2" as const;

export const SESSION_CSV_COLUMNS = [
  ...EXPORT_SOURCE_COLUMNS,
  "assessment_public_id",
  "assessment_title",
  "assessment_status",
  "student_id",
  "display_name",
  "session_public_id",
  "attempt_number",
  "session_status",
  "started_at",
  "completed_at",
  "item_response_count",
  "response_package_count",
  "process_event_count",
  "turn_latency_row_count",
  "engagement_process_feature_row_count",
  "activity_attempt_count",
  "post_activity_evidence_count",
  "diagnostic_snapshot_count",
  "latest_student_safe_status",
  "latest_diagnostic_purpose",
  "unsupported_correct_response_count",
  "estimated_guessing_risk_max",
  "data_completeness_status",
  "limitations"
] as const;

export const MATRIX_CSV_COLUMNS = [
  ...EXPORT_SOURCE_COLUMNS,
  "student_id",
  "display_name",
  "assessment_public_id",
  "assessment_title",
  "assessment_status",
  "session_count",
  "completed_session_count",
  "latest_session_public_id",
  "first_started_at",
  "latest_started_at",
  "latest_completed_at",
  "latest_session_status",
  "total_item_response_count",
  "total_response_package_count",
  "total_process_event_count",
  "total_activity_attempt_count",
  "total_post_activity_evidence_count",
  "total_diagnostic_snapshot_count",
  "unsupported_correct_response_count",
  "estimated_guessing_risk_max",
  "data_completeness_status",
  "limitations"
] as const;

export const SIMPLE_CSV_DATA_DICTIONARY = [
  {
    field: "row grain",
    assessment_csv: "One row per student assessment session attempt for the selected assessment.",
    student_csv: "One row per student assessment session attempt for the selected student.",
    matrix_csv: "One row per student and assessment pair."
  },
  {
    field: "turn_latency_row_count",
    definition:
      "Count of derived prompt-to-next-student-response/action latency rows. Latencies are not exported in this simple CSV."
  },
  {
    field: "engagement_process_feature_row_count",
    definition:
      "Count of derived process-feature rows. These are evidence-quality context indicators, not misconduct or ability labels."
  },
  {
    field: "unsupported_correct_response_count",
    definition:
      "Aggregate internal evidence-quality count, when available, for correct answers not supported by response evidence. It is not a misconduct label."
  },
  {
    field: "estimated_guessing_risk_max",
    definition:
      "Maximum aggregate guessing-risk level available for the session or student-assessment pair: none, low, medium, high, or unavailable."
  },
  {
    field: "privacy boundary",
    definition:
      "Simple CSVs exclude raw responses, process payloads, provider outputs, answer keys, correct options, correctness labels, and diagnostic notes."
  }
] as const;

type SessionCsvColumn = (typeof SESSION_CSV_COLUMNS)[number];
type MatrixCsvColumn = (typeof MATRIX_CSV_COLUMNS)[number];
type CsvPrimitive = string | number | boolean | null;
type SessionCsvRow = Record<SessionCsvColumn, CsvPrimitive>;
type MatrixCsvRow = Record<MatrixCsvColumn, CsvPrimitive>;

const sessionSelect = {
  id: true,
  session_public_id: true,
  attempt_number: true,
  status: true,
  started_at: true,
  completed_at: true,
  created_at: true,
  user: {
    select: {
      user_id: true,
      display_name: true,
      role: true,
      account_status: true,
      created_by_teacher_user_id: true
    }
  },
  assessment: {
    select: {
      assessment_public_id: true,
      title: true,
      status: true,
      created_by_user_db_id: true
    }
  },
  concept_unit_sessions: {
    select: {
      id: true,
      concept_unit: {
        select: {
          concept_unit_public_id: true
        }
      },
      item_responses: {
        select: {
          id: true,
          item_started_at: true,
          item_submitted_at: true,
          item_response_time_ms: true,
          revision_count: true,
          item: {
            select: {
              item_public_id: true,
              item_order: true
            }
          }
        }
      },
      response_packages: {
        select: {
          payload: true,
          created_at: true
        }
      },
      student_profiles: {
        select: {
          item_level_evidence: true,
          recommended_next_evidence: true,
          integrated_diagnostic_profile: true,
          created_at: true
        },
        orderBy: { created_at: "desc" }
      },
      formative_decisions: {
        select: {
          formative_value: true,
          created_at: true
        },
        orderBy: { created_at: "desc" }
      }
    }
  },
  conversation_turns: {
    select: {
      actor_type: true,
      phase: true,
      agent_name: true,
      message_text: true,
      structured_payload: true,
      created_at: true,
      concept_unit_session: {
        select: {
          concept_unit: {
            select: {
              concept_unit_public_id: true
            }
          }
        }
      },
      item: {
        select: {
          item_public_id: true,
          item_order: true
        }
      }
    },
    orderBy: { created_at: "asc" }
  },
  process_events: {
    select: {
      event_type: true,
      event_category: true,
      event_source: true,
      visibility_duration_ms: true,
      pause_duration_ms: true,
      payload: true,
      occurred_at: true,
      created_at: true,
      concept_unit_session: {
        select: {
          concept_unit: {
            select: {
              concept_unit_public_id: true
            }
          }
        }
      },
      item: {
        select: {
          item_public_id: true,
          item_order: true
        }
      }
    },
    orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }]
  },
  agent_calls: {
    select: {
      id: true
    }
  }
} satisfies Prisma.AssessmentSessionSelect;

type ExportSession = Prisma.AssessmentSessionGetPayload<{ select: typeof sessionSelect }>;

function iso(value?: Date | null) {
  return value ? value.toISOString() : "";
}

function dateMs(value?: Date | null) {
  return value ? value.getTime() : 0;
}

function csvSafe(value: CsvPrimitive) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csv<TColumn extends string>(columns: readonly TColumn[], rows: Array<Record<TColumn, CsvPrimitive>>) {
  return stringify(
    rows.map((row) =>
      Object.fromEntries(columns.map((column) => [column, csvSafe(row[column])]))
    ),
    { header: true, columns: [...columns] }
  );
}

function risksFromCounts(counts: unknown) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    return [];
  }

  return Object.entries(counts as Record<string, unknown>)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([risk]) => risk);
}

function maxRisk(risks: Iterable<string>) {
  const rank: Record<string, number> = {
    unavailable: 0,
    none: 1,
    low: 2,
    medium: 3,
    high: 4
  };
  let best = "";
  let bestRank = -1;

  for (const risk of risks) {
    const currentRank = rank[risk] ?? -1;
    if (currentRank > bestRank) {
      best = risk;
      bestRank = currentRank;
    }
  }

  return best;
}

function scanPackageEvidence(value: unknown, result: {
  unsupportedFlags: number;
  unsupportedCountCandidates: number[];
  risks: Set<string>;
}) {
  if (Array.isArray(value)) {
    value.forEach((entry) => scanPackageEvidence(entry, result));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "unsupported_correct_response" && entry === true) {
      result.unsupportedFlags += 1;
    }

    if (key === "unsupported_correct_response_count" && typeof entry === "number" && Number.isFinite(entry)) {
      result.unsupportedCountCandidates.push(Math.max(0, Math.round(entry)));
    }

    if (key === "estimated_guessing_risk" && typeof entry === "string") {
      result.risks.add(entry);
    }

    if (key === "estimated_guessing_risk_counts") {
      risksFromCounts(entry).forEach((risk) => result.risks.add(risk));
    }

    scanPackageEvidence(entry, result);
  }
}

function summarizePackageEvidence(packages: Array<{ payload: Prisma.JsonValue }>) {
  const result = {
    unsupportedFlags: 0,
    unsupportedCountCandidates: [] as number[],
    risks: new Set<string>()
  };

  for (const responsePackage of packages) {
    scanPackageEvidence(responsePackage.payload, result);
  }

  const unsupportedCount = Math.max(
    result.unsupportedFlags,
    ...result.unsupportedCountCandidates,
    0
  );
  const risk = maxRisk(result.risks);

  return {
    available:
      result.unsupportedFlags > 0 ||
      result.unsupportedCountCandidates.length > 0 ||
      result.risks.size > 0,
    unsupported_correct_response_count: unsupportedCount,
    estimated_guessing_risk_max: risk
  };
}

function inferStudentSafeStatus(profile: ExportSession["concept_unit_sessions"][number]["student_profiles"][number] | null) {
  if (!profile) {
    return { status: "", limitation: "latest_student_safe_status_unavailable" };
  }

  const projected = projectStoredStudentProfileIntegration(profile);
  if (projected) {
    return { status: projected.status, limitation: null };
  }

  switch (profile.integrated_diagnostic_profile) {
    case "robust_understanding_ready_for_transfer":
    case "underconfident_but_reasoning_supported":
      return {
        status: "Mostly understood",
        limitation: "latest_student_safe_status_inferred_from_profile"
      };
    case "insufficient_evidence_for_formative_decision":
    case "low_engagement_limits_interpretability":
      return {
        status: "Needs more work",
        limitation: "latest_student_safe_status_inferred_from_profile"
      };
    default:
      return {
        status: "Still developing",
        limitation: "latest_student_safe_status_inferred_from_profile"
      };
  }
}

function latestByCreatedAt<T extends { created_at: Date }>(records: T[]) {
  return [...records].sort((left, right) => dateMs(right.created_at) - dateMs(left.created_at))[0] ?? null;
}

function dataCompletenessStatus(input: {
  session_count?: number;
  session_status?: string;
  item_response_count: number;
  response_package_count: number;
  process_event_count: number;
}) {
  if (input.session_count === 0) {
    return "no_session";
  }

  if (
    input.session_status === "completed" &&
    input.item_response_count > 0 &&
    input.response_package_count > 0 &&
    input.process_event_count > 0
  ) {
    return "complete";
  }

  if (input.item_response_count > 0 && input.response_package_count > 0) {
    return "mostly_complete";
  }

  return "partial";
}

async function loadActivityCounts(sessionPublicId: string) {
  const [
    activity_attempt_count,
    post_activity_evidence_count,
    diagnostic_snapshot_count,
    latestSnapshot,
    latestAttempt
  ] = await Promise.all([
    prisma.activityRuntimeAttempt.count({ where: { session_public_id: sessionPublicId } }),
    prisma.activityMisconceptionEvidenceRecord.count({ where: { session_public_id: sessionPublicId } }),
    prisma.postActivityDiagnosticSnapshot.count({ where: { session_public_id: sessionPublicId } }),
    prisma.postActivityDiagnosticSnapshot.findFirst({
      where: { session_public_id: sessionPublicId },
      orderBy: { created_at: "desc" },
      select: { next_diagnostic_purpose: true }
    }),
    prisma.activityRuntimeAttempt.findFirst({
      where: { session_public_id: sessionPublicId },
      orderBy: { created_at: "desc" },
      select: { diagnostic_purpose: true }
    })
  ]);

  return {
    activity_attempt_count,
    post_activity_evidence_count,
    diagnostic_snapshot_count,
    latest_diagnostic_purpose:
      latestSnapshot?.next_diagnostic_purpose ?? latestAttempt?.diagnostic_purpose ?? ""
  };
}

function buildTurnLatencyCount(session: ExportSession) {
  return buildTurnResponseLatencyRows({
    turns: session.conversation_turns.map((turn, index) => ({
      session_public_id: session.session_public_id,
      student_user_id: session.user.user_id,
      assessment_public_id: session.assessment.assessment_public_id,
      turn_index: index + 1,
      actor_type: turn.actor_type,
      phase: turn.phase,
      agent_name: turn.agent_name,
      message_text: turn.message_text,
      structured_payload: turn.structured_payload,
      created_at: turn.created_at,
      concept_unit_public_id:
        turn.concept_unit_session?.concept_unit.concept_unit_public_id ?? null,
      item_public_id: turn.item?.item_public_id ?? null,
      item_order: turn.item?.item_order ?? null
    })),
    processEvents: session.process_events.map((event) => ({
      session_public_id: session.session_public_id,
      concept_unit_public_id:
        event.concept_unit_session?.concept_unit.concept_unit_public_id ?? null,
      item_public_id: event.item?.item_public_id ?? null,
      item_order: event.item?.item_order ?? null,
      event_type: event.event_type,
      event_category: event.event_category,
      event_source: event.event_source,
      occurred_at: event.occurred_at,
      created_at: event.created_at
    }))
  }).length;
}

function buildEngagementFeatureCount(session: ExportSession) {
  const itemResponses = session.concept_unit_sessions.flatMap((conceptUnitSession) =>
    conceptUnitSession.item_responses.map((response) => ({
      session_public_id: session.session_public_id,
      student_user_id: session.user.user_id,
      assessment_public_id: session.assessment.assessment_public_id,
      concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
      item_public_id: response.item.item_public_id,
      item_order: response.item.item_order,
      item_started_at: response.item_started_at,
      item_submitted_at: response.item_submitted_at,
      item_response_time_ms: response.item_response_time_ms,
      revision_count: response.revision_count
    }))
  );

  return buildEngagementProcessFeatureRows({
    itemResponses,
    processEvents: session.process_events.map((event) => ({
      session_public_id: session.session_public_id,
      concept_unit_public_id:
        event.concept_unit_session?.concept_unit.concept_unit_public_id ?? null,
      item_public_id: event.item?.item_public_id ?? null,
      item_order: event.item?.item_order ?? null,
      event_type: event.event_type,
      event_category: event.event_category,
      event_source: event.event_source,
      visibility_duration_ms: event.visibility_duration_ms,
      pause_duration_ms: event.pause_duration_ms,
      payload: event.payload,
      occurred_at: event.occurred_at,
      created_at: event.created_at
    }))
  }).length;
}

async function correctnessSummary(
  sessionPublicId: string,
  packages: Array<{ payload: Prisma.JsonValue }>
) {
  const fromPackages = summarizePackageEvidence(packages);

  try {
    const packet = await buildAbilityEvidencePacketForSession(sessionPublicId);
    return {
      unsupported_correct_response_count:
        packet.concept_level_summary.unsupported_correct_response_count,
      estimated_guessing_risk_max:
        maxRisk(Object.entries(packet.concept_level_summary.estimated_guessing_risk_counts)
          .filter(([, count]) => count > 0)
          .map(([risk]) => risk)) || "unavailable",
      limitations: [] as string[]
    };
  } catch {
    if (fromPackages.available) {
      return {
        unsupported_correct_response_count: fromPackages.unsupported_correct_response_count,
        estimated_guessing_risk_max: fromPackages.estimated_guessing_risk_max || "unavailable",
        limitations: ["ability_packet_unavailable_used_response_package_aggregate"]
      };
    }

    return {
      unsupported_correct_response_count: "",
      estimated_guessing_risk_max: "unavailable",
      limitations: ["ability_evidence_summary_unavailable"]
    };
  }
}

async function buildSessionRow(
  session: ExportSession,
  source: ExportSourceIdentity
): Promise<SessionCsvRow> {
  const itemResponses = session.concept_unit_sessions.flatMap((entry) => entry.item_responses);
  const responsePackages = session.concept_unit_sessions.flatMap((entry) => entry.response_packages);
  const profiles = session.concept_unit_sessions.flatMap((entry) => entry.student_profiles);
  const decisions = session.concept_unit_sessions.flatMap((entry) => entry.formative_decisions);
  const latestProfile = latestByCreatedAt(profiles);
  const latestDecision = latestByCreatedAt(decisions);
  const status = inferStudentSafeStatus(latestProfile);
  const activityCounts = await loadActivityCounts(session.session_public_id);
  const correctness = await correctnessSummary(session.session_public_id, responsePackages);
  const limitations = new Set<string>(correctness.limitations);

  if (status.limitation) limitations.add(status.limitation);
  if (responsePackages.length === 0) limitations.add("response_package_missing");
  if (activityCounts.activity_attempt_count === 0) limitations.add("activity_attempts_missing");
  if (activityCounts.post_activity_evidence_count === 0) limitations.add("post_activity_evidence_missing");
  if (activityCounts.diagnostic_snapshot_count === 0) limitations.add("diagnostic_snapshots_missing");

  return {
    ...sourceIdentityRow(source),
    assessment_public_id: session.assessment.assessment_public_id,
    assessment_title: session.assessment.title,
    assessment_status: session.assessment.status,
    student_id: session.user.user_id,
    display_name: session.user.display_name ?? "",
    session_public_id: session.session_public_id,
    attempt_number: session.attempt_number,
    session_status: session.status,
    started_at: iso(session.started_at),
    completed_at: iso(session.completed_at),
    item_response_count: itemResponses.length,
    response_package_count: responsePackages.length,
    process_event_count: session.process_events.length,
    turn_latency_row_count: buildTurnLatencyCount(session),
    engagement_process_feature_row_count: buildEngagementFeatureCount(session),
    activity_attempt_count: activityCounts.activity_attempt_count,
    post_activity_evidence_count: activityCounts.post_activity_evidence_count,
    diagnostic_snapshot_count: activityCounts.diagnostic_snapshot_count,
    latest_student_safe_status: status.status,
    latest_diagnostic_purpose:
      activityCounts.latest_diagnostic_purpose || latestDecision?.formative_value || "",
    unsupported_correct_response_count: correctness.unsupported_correct_response_count,
    estimated_guessing_risk_max: correctness.estimated_guessing_risk_max,
    data_completeness_status: dataCompletenessStatus({
      session_status: session.status,
      item_response_count: itemResponses.length,
      response_package_count: responsePackages.length,
      process_event_count: session.process_events.length
    }),
    limitations: [...limitations].sort().join(";")
  };
}

function rowSort(left: SessionCsvRow, right: SessionCsvRow) {
  return (
    String(left.assessment_title).localeCompare(String(right.assessment_title)) ||
    String(left.assessment_public_id).localeCompare(String(right.assessment_public_id)) ||
    String(left.student_id).localeCompare(String(right.student_id)) ||
    Number(left.attempt_number) - Number(right.attempt_number) ||
    String(left.session_public_id).localeCompare(String(right.session_public_id))
  );
}

function authorizedSessionOr(teacherUserDbId: string): Prisma.AssessmentSessionWhereInput[] {
  return [
    { assessment: { created_by_user_db_id: teacherUserDbId } },
    { user: { created_by_teacher_user_id: teacherUserDbId } }
  ];
}

async function loadSessions(input: {
  teacher_user_db_id: string;
  assessment_public_id?: string;
  student_user_id?: string;
}) {
  return prisma.assessmentSession.findMany({
    where: {
      assessment: {
        assessment_public_id: input.assessment_public_id
      },
      user: {
        role: "student",
        account_status: "active",
        user_id: input.student_user_id
      },
      OR: authorizedSessionOr(input.teacher_user_db_id)
    },
    select: sessionSelect,
    orderBy: [
      { assessment: { title: "asc" } },
      { user: { user_id: "asc" } },
      { attempt_number: "asc" },
      { created_at: "asc" }
    ]
  });
}

async function assertAssessment(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const assessment = await prisma.assessment.findFirst({
    where: {
      assessment_public_id: input.assessment_public_id,
      OR: [
        { created_by_user_db_id: input.teacher_user_db_id },
        {
          assessment_sessions: {
            some: {
              user: {
                role: "student",
                account_status: "active",
                created_by_teacher_user_id: input.teacher_user_db_id
              }
            }
          }
        }
      ]
    },
    select: { assessment_public_id: true, title: true }
  });

  if (!assessment) {
    throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  }

  return assessment;
}

async function assertStudent(input: { teacher_user_db_id: string; student_user_id: string }) {
  const student = await prisma.user.findFirst({
    where: {
      user_id: input.student_user_id,
      role: "student",
      account_status: "active",
      OR: [
        { created_by_teacher_user_id: input.teacher_user_db_id },
        {
          assessment_sessions: {
            some: {
              assessment: {
                created_by_user_db_id: input.teacher_user_db_id
              }
            }
          }
        }
      ]
    },
    select: { user_id: true, display_name: true }
  });

  if (!student) {
    throw new ContentServiceError("not_found", "Student was not found.", 404);
  }

  return student;
}

function fileResult(fileName: string, content: string) {
  return {
    file_name: fileName,
    content_type: "text/csv; charset=utf-8",
    content
  };
}

export async function listSimpleCsvExplorerOptions(input: { teacher_user_db_id: string }) {
  const [assessments, students, sessions] = await Promise.all([
    prisma.assessment.findMany({
      where: {
        OR: [
          { created_by_user_db_id: input.teacher_user_db_id },
          {
            assessment_sessions: {
              some: {
                user: {
                  role: "student",
                  account_status: "active",
                  created_by_teacher_user_id: input.teacher_user_db_id
                }
              }
            }
          }
        ]
      },
      orderBy: [{ title: "asc" }, { assessment_public_id: "asc" }],
      select: {
        assessment_public_id: true,
        title: true,
        status: true
      }
    }),
    prisma.user.findMany({
      where: {
        role: "student",
        account_status: "active",
        OR: [
          { created_by_teacher_user_id: input.teacher_user_db_id },
          {
            assessment_sessions: {
              some: {
                assessment: {
                  created_by_user_db_id: input.teacher_user_db_id
                }
              }
            }
          }
        ]
      },
      orderBy: [{ user_id: "asc" }],
      select: {
        user_id: true,
        display_name: true,
        account_status: true
      }
    }),
    loadSessions({ teacher_user_db_id: input.teacher_user_db_id })
  ]);
  const supplementalBySession = await loadSupplementalAvailabilityCounts(
    sessions.map((session) => session.session_public_id)
  );
  const countsByAssessment = new Map<string, ExportAvailabilityCounts>();
  const countsByStudent = new Map<string, ExportAvailabilityCounts>();

  for (const session of sessions) {
    const counts = countsForSession(
      session,
      supplementalBySession.get(session.session_public_id)
    );
    mergeCounts(countsByAssessment, session.assessment.assessment_public_id, counts);
    mergeCounts(countsByStudent, session.user.user_id, counts);
  }

  return {
    export_version: TEACHER_SIMPLE_CSV_EXPORT_VERSION,
    assessments: assessments.map((assessment) => {
      const counts = countsByAssessment.get(assessment.assessment_public_id) ?? emptyAvailabilityCounts();
      return {
        ...assessment,
        counts,
        availability: availabilityForCounts(counts)
      };
    }),
    students: students.map((student) => {
      const counts = countsByStudent.get(student.user_id) ?? emptyAvailabilityCounts();
      return {
        ...student,
        counts,
        availability: availabilityForCounts(counts)
      };
    }),
    data_dictionary: SIMPLE_CSV_DATA_DICTIONARY
  };
}

type ExportAvailabilityCounts = {
  sessions: number;
  item_responses: number;
  process_events: number;
  latency_rows: number;
  conversation_turns: number;
  response_packages: number;
  agent_calls: number;
  activity_attempts: number;
  post_activity_evidence: number;
  diagnostic_snapshots: number;
};

type SupplementalAvailabilityCounts = Pick<
  ExportAvailabilityCounts,
  "activity_attempts" | "post_activity_evidence" | "diagnostic_snapshots"
>;

function emptyAvailabilityCounts(): ExportAvailabilityCounts {
  return {
    sessions: 0,
    item_responses: 0,
    process_events: 0,
    latency_rows: 0,
    conversation_turns: 0,
    response_packages: 0,
    agent_calls: 0,
    activity_attempts: 0,
    post_activity_evidence: 0,
    diagnostic_snapshots: 0
  };
}

function emptySupplementalAvailabilityCounts(): SupplementalAvailabilityCounts {
  return {
    activity_attempts: 0,
    post_activity_evidence: 0,
    diagnostic_snapshots: 0
  };
}

async function loadSupplementalAvailabilityCounts(sessionPublicIds: string[]) {
  if (sessionPublicIds.length === 0) {
    return new Map<string, SupplementalAvailabilityCounts>();
  }

  const [activityAttempts, evidenceRecords, diagnosticSnapshots] = await Promise.all([
    prisma.activityRuntimeAttempt.groupBy({
      by: ["session_public_id"],
      where: { session_public_id: { in: sessionPublicIds } },
      _count: { _all: true }
    }),
    prisma.activityMisconceptionEvidenceRecord.groupBy({
      by: ["session_public_id"],
      where: { session_public_id: { in: sessionPublicIds } },
      _count: { _all: true }
    }),
    prisma.postActivityDiagnosticSnapshot.groupBy({
      by: ["session_public_id"],
      where: { session_public_id: { in: sessionPublicIds } },
      _count: { _all: true }
    })
  ]);

  const counts = new Map<string, SupplementalAvailabilityCounts>();
  for (const sessionPublicId of sessionPublicIds) {
    counts.set(sessionPublicId, emptySupplementalAvailabilityCounts());
  }
  for (const entry of activityAttempts) {
    const current = counts.get(entry.session_public_id) ?? emptySupplementalAvailabilityCounts();
    counts.set(entry.session_public_id, {
      ...current,
      activity_attempts: entry._count._all
    });
  }
  for (const entry of evidenceRecords) {
    const current = counts.get(entry.session_public_id) ?? emptySupplementalAvailabilityCounts();
    counts.set(entry.session_public_id, {
      ...current,
      post_activity_evidence: entry._count._all
    });
  }
  for (const entry of diagnosticSnapshots) {
    const current = counts.get(entry.session_public_id) ?? emptySupplementalAvailabilityCounts();
    counts.set(entry.session_public_id, {
      ...current,
      diagnostic_snapshots: entry._count._all
    });
  }

  return counts;
}

function countsForSession(
  session: ExportSession,
  supplemental: SupplementalAvailabilityCounts = emptySupplementalAvailabilityCounts()
): ExportAvailabilityCounts {
  return {
    sessions: 1,
    item_responses: session.concept_unit_sessions.flatMap((entry) => entry.item_responses).length,
    process_events: session.process_events.length,
    latency_rows: buildTurnLatencyCount(session),
    conversation_turns: session.conversation_turns.length,
    response_packages: session.concept_unit_sessions.flatMap((entry) => entry.response_packages).length,
    agent_calls: session.agent_calls.length,
    activity_attempts: supplemental.activity_attempts,
    post_activity_evidence: supplemental.post_activity_evidence,
    diagnostic_snapshots: supplemental.diagnostic_snapshots
  };
}

function mergeCounts(
  map: Map<string, ExportAvailabilityCounts>,
  key: string,
  next: ExportAvailabilityCounts
) {
  const current = map.get(key) ?? emptyAvailabilityCounts();
  map.set(key, Object.fromEntries(
    Object.keys(current).map((countKey) => [
      countKey,
      current[countKey as keyof ExportAvailabilityCounts] +
        next[countKey as keyof ExportAvailabilityCounts]
    ])
  ) as ExportAvailabilityCounts);
}

function availabilityForCounts(counts: ExportAvailabilityCounts) {
  if (counts.sessions === 0) return "No sessions";
  if (counts.item_responses === 0) return "Session exists but no item response";
  if (counts.process_events === 0 || counts.conversation_turns === 0) {
    return "Legacy session with partial instrumentation";
  }
  return "Data available";
}

export async function downloadAssessmentCsv(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  await assertAssessment(input);
  const sessions = await loadSessions(input);
  if (sessions.length === 0) {
    throw new ContentServiceError(
      "no_session_data",
      "No student sessions are available for this assessment.",
      409
    );
  }
  const source = buildExportSourceIdentity({
    export_schema_version: TEACHER_SIMPLE_CSV_EXPORT_VERSION,
    export_scope: "selected_assessment_summary",
    selected_assessment_public_id: input.assessment_public_id
  });
  const rows = (await Promise.all(sessions.map((session) => buildSessionRow(session, source)))).sort(rowSort);

  return fileResult(
    `assessment_${input.assessment_public_id}_students.csv`,
    csv(SESSION_CSV_COLUMNS, rows)
  );
}

export async function downloadStudentCsv(input: {
  teacher_user_db_id: string;
  student_user_id: string;
}) {
  await assertStudent(input);
  const sessions = await loadSessions(input);
  if (sessions.length === 0) {
    throw new ContentServiceError(
      "no_session_data",
      "No student sessions are available for this student.",
      409
    );
  }
  const source = buildExportSourceIdentity({
    export_schema_version: TEACHER_SIMPLE_CSV_EXPORT_VERSION,
    export_scope: "selected_student_summary",
    selected_student_id: input.student_user_id
  });
  const rows = (await Promise.all(sessions.map((session) => buildSessionRow(session, source)))).sort(rowSort);

  return fileResult(
    `student_${input.student_user_id}_sessions.csv`,
    csv(SESSION_CSV_COLUMNS, rows)
  );
}

function aggregateRows(input: {
  student: { user_id: string; display_name: string | null };
  assessment: { assessment_public_id: string; title: string; status: string };
  rows: SessionCsvRow[];
  source: ExportSourceIdentity;
}): MatrixCsvRow {
  if (input.rows.length === 0) {
    return {
      ...sourceIdentityRow(input.source),
      student_id: input.student.user_id,
      display_name: input.student.display_name ?? "",
      assessment_public_id: input.assessment.assessment_public_id,
      assessment_title: input.assessment.title,
      assessment_status: input.assessment.status,
      session_count: 0,
      completed_session_count: 0,
      latest_session_public_id: "",
      first_started_at: "",
      latest_started_at: "",
      latest_completed_at: "",
      latest_session_status: "",
      total_item_response_count: 0,
      total_response_package_count: 0,
      total_process_event_count: 0,
      total_activity_attempt_count: 0,
      total_post_activity_evidence_count: 0,
      total_diagnostic_snapshot_count: 0,
      unsupported_correct_response_count: 0,
      estimated_guessing_risk_max: "unavailable",
      data_completeness_status: "no_session",
      limitations: "no_session"
    };
  }

  const sortedByStarted = [...input.rows].sort((left, right) =>
    String(left.started_at || "").localeCompare(String(right.started_at || ""))
  );
  const latest = sortedByStarted[sortedByStarted.length - 1];
  const risks = input.rows.map((row) => String(row.estimated_guessing_risk_max || ""));
  const limitations = new Set<string>();

  for (const row of input.rows) {
    String(row.limitations || "")
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => limitations.add(entry));
  }

  return {
    ...sourceIdentityRow(input.source),
    student_id: input.student.user_id,
    display_name: input.student.display_name ?? "",
    assessment_public_id: input.assessment.assessment_public_id,
    assessment_title: input.assessment.title,
    assessment_status: input.assessment.status,
    session_count: input.rows.length,
    completed_session_count: input.rows.filter((row) => row.session_status === "completed").length,
    latest_session_public_id: String(latest.session_public_id),
    first_started_at: String(sortedByStarted[0]?.started_at ?? ""),
    latest_started_at: String(latest.started_at ?? ""),
    latest_completed_at: String(latest.completed_at ?? ""),
    latest_session_status: String(latest.session_status ?? ""),
    total_item_response_count: input.rows.reduce((total, row) => total + Number(row.item_response_count), 0),
    total_response_package_count: input.rows.reduce((total, row) => total + Number(row.response_package_count), 0),
    total_process_event_count: input.rows.reduce((total, row) => total + Number(row.process_event_count), 0),
    total_activity_attempt_count: input.rows.reduce((total, row) => total + Number(row.activity_attempt_count), 0),
    total_post_activity_evidence_count: input.rows.reduce((total, row) => total + Number(row.post_activity_evidence_count), 0),
    total_diagnostic_snapshot_count: input.rows.reduce((total, row) => total + Number(row.diagnostic_snapshot_count), 0),
    unsupported_correct_response_count: input.rows.reduce((total, row) => {
      const value = Number(row.unsupported_correct_response_count);
      return total + (Number.isFinite(value) ? value : 0);
    }, 0),
    estimated_guessing_risk_max: maxRisk(risks) || "unavailable",
    data_completeness_status: input.rows.every((row) => row.data_completeness_status === "complete")
      ? "complete"
      : "partial",
    limitations: [...limitations].sort().join(";")
  };
}

export async function downloadStudentAssessmentMatrixCsv(input: { teacher_user_db_id: string }) {
  const [options, sessions] = await Promise.all([
    listSimpleCsvExplorerOptions(input),
    loadSessions(input)
  ]);
  const source = buildExportSourceIdentity({
    export_schema_version: TEACHER_SIMPLE_CSV_EXPORT_VERSION,
    export_scope: "student_assessment_matrix"
  });
  const sessionRows = await Promise.all(sessions.map((session) => buildSessionRow(session, source)));
  const grouped = new Map<string, SessionCsvRow[]>();

  for (const row of sessionRows) {
    const key = `${row.student_id}\u0000${row.assessment_public_id}`;
    const rows = grouped.get(key) ?? [];
    rows.push(row);
    grouped.set(key, rows);
  }

  const rows = options.students.flatMap((student) =>
    options.assessments.map((assessment) =>
      aggregateRows({
        student,
        assessment,
        source,
        rows: grouped.get(`${student.user_id}\u0000${assessment.assessment_public_id}`) ?? []
      })
    )
  );

  return fileResult("student_assessment_matrix.csv", csv(MATRIX_CSV_COLUMNS, rows));
}
