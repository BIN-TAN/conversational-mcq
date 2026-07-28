import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ContentServiceError } from "@/lib/services/content/errors";
import { asArray, asRecord } from "@/lib/services/teacher-review/serializers";
import {
  TIMING_CONTRACT_VERSION,
  TIMING_SOURCE_VERSION,
  deriveItemTiming,
  deriveSessionTiming,
  deriveVisibilityIntervals,
  eventTimestamp,
  timingLimitationsText
} from "@/lib/services/student-assessment/timing-contract";
import {
  latestPersistedFormativeConversationProfileTransition,
  persistedFormativeConversationOutcome
} from "@/lib/services/student-assessment/formative-conversation/profile-projection";
import { createStoreOnlyZip } from "@/lib/services/teacher-research-export/zip";
import {
  buildExportSourceIdentity,
  sourceIdentityRow,
  type ExportSourceIdentity
} from "@/lib/services/teacher-research-export/source-identity";
import {
  AGENT_ACTIVITY_RECORDS_COLUMNS,
  ANALYSIS_READY_EXPORT_VERSION,
  ASSESSMENT_CONTENT_COLUMNS,
  ASSESSMENT_SUMMARY_COLUMNS,
  CONVERSATION_TURNS_COLUMNS,
  dataDictionaryCsv,
  ITEM_RESPONSES_COLUMNS,
  processEventCodebookCsv,
  PROCESS_EVENTS_COLUMNS,
  SESSIONS_COLUMNS
} from "./dictionary";
import {
  ResearchPseudonymizationConfigError,
  assertResearchPseudonymizationReadyForExport,
  researchPseudonymizationMetadata,
  researchStudentId
} from "./pseudonymization";

type CsvPrimitive = string | number | boolean | null;
type CsvRow = Record<string, CsvPrimitive>;

const restrictedDefaultColumns = new Set([
  "correct_option",
  "correctness",
  "correctness_support_level",
  "unsupported_correct_response",
  "estimated_guessing_risk",
  "answer_selection_evidence_weight",
  "teacher_llm_media_description",
  "target_reasoning_note",
  "strong_reasoning_note",
  "distractor_diagnostic_notes"
]);

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /authorization\s*:/i,
  /bearer\s+[A-Za-z0-9._-]{10,}/i,
  /password_hash/i,
  /access_code_hash/i,
  /session_secret/i,
  /database_url/i,
  /postgresql:\/\//i
];

const analysisSessionSelect = {
  id: true,
  session_public_id: true,
  attempt_number: true,
  status: true,
  current_phase: true,
  resume_phase: true,
  started_at: true,
  last_activity_at: true,
  completed_at: true,
  created_at: true,
  updated_at: true,
  user: {
    select: {
      user_id: true,
      display_name: true,
      account_status: true,
      role: true,
      created_by_teacher_user_id: true
    }
  },
  assessment: {
    select: {
      assessment_public_id: true,
      title: true,
      description: true,
      diagnostic_focus: true,
      folder_label: true,
      status: true,
      release_at: true,
      close_at: true,
      created_by_user_db_id: true
    }
  },
  concept_unit_sessions: {
    orderBy: [{ concept_unit: { order_index: "asc" } }, { created_at: "asc" }],
    include: {
      concept_unit: {
        select: {
          concept_unit_public_id: true,
          title: true,
          order_index: true,
          version: true
        }
      },
      item_responses: {
        orderBy: [{ item: { item_order: "asc" } }, { created_at: "asc" }],
        include: {
          item: {
            select: {
              item_public_id: true,
              item_order: true,
              item_stem: true,
              options: true,
              correct_option: true,
              distractor_rationales: true,
              expected_reasoning_patterns: true,
              possible_misconception_indicators: true,
              version: true,
              media_assets: {
                where: { active: true },
                orderBy: [{ order_index: "asc" }, { created_at: "asc" }],
                select: {
                  media_public_id: true,
                  media_version: true,
                  student_alt_text: true,
                  alt_text_or_description: true,
                  teacher_llm_media_description: true
                }
              }
            }
          }
        }
      },
      response_packages: {
        orderBy: [{ created_at: "asc" }],
        select: {
          package_type: true,
          payload: true,
          created_at: true
        }
      },
      student_profiles: {
        orderBy: [{ created_at: "desc" }],
        select: {
          profile_type: true,
          ability_profile: true,
          engagement_profile: true,
          integrated_diagnostic_profile: true,
          evidence_sufficiency: true,
          reasoning_quality_summary: true,
          engagement_summary: true,
          item_level_evidence: true,
          recommended_next_evidence: true,
          created_at: true
        }
      },
      formative_decisions: {
        orderBy: [{ created_at: "desc" }],
        select: {
          formative_value: true,
          formative_action_plan: true,
          rationale: true,
          mapping_followed: true,
          mapping_deviation_reason: true,
          created_at: true
        }
      },
      followup_rounds: {
        orderBy: [{ round_index: "asc" }],
        select: {
          round_index: true,
          status: true,
          evidence_trigger_type: true,
          started_at: true,
          completed_at: true,
          created_at: true
        }
      }
    }
  },
  conversation_turns: {
    orderBy: [{ sequence_index: "asc" }],
    include: {
      item: { select: { item_public_id: true, item_order: true } },
      concept_unit_session: {
        select: {
          concept_unit: { select: { concept_unit_public_id: true, title: true } }
        }
      }
    }
  },
  process_events: {
    orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }],
    include: {
      item: { select: { item_public_id: true, item_order: true } },
      concept_unit_session: {
        select: {
          concept_unit: { select: { concept_unit_public_id: true, title: true } }
        }
      }
    }
  },
  agent_calls: {
    orderBy: [{ created_at: "asc" }],
    select: {
      agent_call_public_id: true,
      agent_name: true,
      agent_version: true,
      provider: true,
      model_name: true,
      call_status: true,
      blocked_reason: true,
      started_at: true,
      completed_at: true,
      retry_count: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true,
      prompt_version: true,
      schema_version: true,
      output_validated: true,
      validation_error: true,
      created_at: true
    }
  },
  formative_conversation_sessions: {
    orderBy: { started_at: "asc" },
    include: {
      concept_unit_session: {
        select: {
          concept_unit: {
            select: {
              concept_unit_public_id: true
            }
          }
        }
      },
      initial_student_profile: {
        select: {
          integrated_diagnostic_profile: true,
          evidence_sufficiency: true,
          created_at: true
        }
      },
      current_student_profile: {
        select: {
          integrated_diagnostic_profile: true,
          evidence_sufficiency: true,
          created_at: true
        }
      },
      conversation_turns: {
        where: {
          actor_type: { in: ["student", "agent"] },
          message_text: { not: null }
        },
        orderBy: { sequence_index: "asc" },
        include: {
          formative_conversation_turn_telemetry: {
            include: {
              agent_call: {
                select: {
                  agent_call_public_id: true
                }
              }
            }
          },
          formative_conversation_input_telemetry: true
        }
      },
      lifecycle_events: {
        orderBy: { sequence_index: "asc" }
      },
      agent_calls: {
        orderBy: { created_at: "asc" },
        select: {
          agent_call_public_id: true,
          agent_name: true,
          agent_version: true,
          provider: true,
          model_name: true,
          prompt_version: true,
          schema_version: true,
          formative_conversation_context_version: true,
          call_status: true,
          output_validated: true,
          retry_count: true,
          latency_ms: true,
          input_tokens: true,
          output_tokens: true,
          total_tokens: true,
          started_at: true,
          completed_at: true,
          created_at: true
        }
      },
      profile_transitions: {
        orderBy: { transitioned_at: "asc" },
        include: {
          prior_student_profile: {
            select: {
              ability_profile: true,
              integrated_diagnostic_profile: true,
              evidence_sufficiency: true,
              confidence_alignment: true,
              misconception_indicators: true,
              created_at: true
            }
          },
          updated_student_profile: {
            select: {
              ability_profile: true,
              integrated_diagnostic_profile: true,
              evidence_sufficiency: true,
              confidence_alignment: true,
              misconception_indicators: true,
              created_at: true
            }
          },
          source_turn: {
            select: {
              sequence_index: true
            }
          },
          source_agent_call: {
            select: {
              agent_call_public_id: true,
              agent_name: true,
            }
          },
          supporting_turn_references: {
            include: {
              conversation_turn: {
                select: {
                  sequence_index: true,
                  actor_type: true
                }
              }
            }
          },
          profile_evidence_references: {
            select: {
              evidence_reference_public_id: true
            },
            orderBy: {
              evidence_observation_index: "asc"
            }
          },
          assessment_student_profile: {
            select: {
              created_at: true
            }
          }
        }
      },
      interventions: {
        orderBy: { started_at: "asc" },
        select: {
          intervention_public_id: true,
          strategy_type: true,
          targeted_evidence_gap: true,
          status: true,
          started_at: true,
          completed_at: true
        }
      }
    }
  },
  workflow_jobs: {
    orderBy: [{ created_at: "asc" }],
    select: {
      job_public_id: true,
      job_type: true,
      status: true,
      attempt_count: true,
      max_attempts: true,
      last_error_category: true,
      last_error_message: true,
      created_at: true,
      completed_at: true
    }
  }
} satisfies Prisma.AssessmentSessionSelect;

type AnalysisSession = Prisma.AssessmentSessionGetPayload<{ select: typeof analysisSessionSelect }>;

type SupplementalRecords = Awaited<ReturnType<typeof loadSupplementalRecords>>;

const FORMATIVE_CONVERSATION_SESSION_COLUMNS = [
  "session_public_id",
  "research_student_id",
  "assessment_public_id",
  "concept_unit_public_id",
  "conversation_public_id",
  "conversation_status",
  "started_at",
  "last_activity_at",
  "paused_at",
  "completed_at",
  "ended_at",
  "wall_clock_duration_ms",
  "turn_count",
  "lifecycle_event_count",
  "agent_call_count",
  "intervention_count",
  "profile_transition_count",
  "latest_profile_transition_public_id",
  "validated_formative_outcome",
  "initial_learning_profile",
  "initial_profile_evidence_sufficiency",
  "current_learning_profile",
  "current_profile_evidence_sufficiency"
] as const;

const FORMATIVE_CONVERSATION_TURN_COLUMNS = [
  "session_public_id",
  "research_student_id",
  "conversation_public_id",
  "agent_call_public_id",
  "turn_sequence_index",
  "conversation_local_turn_sequence_index",
  "actor_type",
  "actor_name",
  "message_text",
  "generation_source",
  "validator_status",
  "fallback_used",
  "created_at",
  "turn_started_at",
  "turn_submitted_at",
  "response_time_ms",
  "message_length_chars",
  "input_token_count",
  "output_token_count",
  "typing_started_at",
  "typing_ended_at",
  "typing_duration_ms",
  "typing_duration_method",
  "edit_count",
  "backspace_count",
  "paste_event_count",
  "paste_character_count",
  "final_message_length_chars"
] as const;

const FORMATIVE_CONVERSATION_EVENT_COLUMNS = [
  "event_public_id",
  "session_public_id",
  "research_student_id",
  "conversation_public_id",
  "event_sequence_index",
  "conversation_local_event_sequence_index",
  "event_type",
  "event_source",
  "observed_interval_duration_ms",
  "occurred_at",
  "created_at"
] as const;

const FORMATIVE_CONVERSATION_LLM_COLUMNS = [
  "session_public_id",
  "research_student_id",
  "conversation_public_id",
  "agent_call_public_id",
  "agent_call_index",
  "agent_name",
  "agent_version",
  "provider",
  "model_name",
  "prompt_version",
  "schema_version",
  "context_version",
  "call_status",
  "output_validated",
  "retry_count",
  "latency_ms",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "started_at",
  "completed_at"
] as const;

const FORMATIVE_CONVERSATION_PROFILE_TRANSITION_COLUMNS = [
  "transition_public_id",
  "session_public_id",
  "research_student_id",
  "conversation_public_id",
  "transition_version",
  "formative_outcome",
  "prior_understanding_category",
  "prior_learning_profile",
  "prior_evidence_sufficiency",
  "prior_confidence_alignment",
  "prior_misconception_indicators",
  "prior_profile_created_at",
  "updated_understanding_category",
  "updated_learning_profile",
  "updated_evidence_sufficiency",
  "updated_confidence_alignment",
  "updated_misconception_indicators",
  "updated_profile_created_at",
  "canonical_profile_snapshot",
  "learning_observations",
  "evidence_interpretation",
  "source_turn_sequence_index",
  "supporting_turn_sequence_indexes",
  "supporting_turn_actors",
  "supporting_turn_evidence_roles",
  "evidence_reference_public_ids",
  "assessment_profile_created_at",
  "source_agent_name",
  "source_agent_call_public_id",
  "transitioned_at"
] as const;

const FORMATIVE_CONVERSATION_INTERVENTION_COLUMNS = [
  "intervention_public_id",
  "session_public_id",
  "research_student_id",
  "conversation_public_id",
  "strategy_type",
  "targeted_evidence_gap",
  "status",
  "started_at",
  "completed_at"
] as const;

const FORMATIVE_CONVERSATION_DICTIONARY_COLUMNS = [
  "dataset",
  "variable",
  "definition",
  "source_nature",
  "analysis_phase",
  "interpretation_caution"
] as const;

function iso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function ms(value?: Date | null) {
  return value ? value.getTime() : null;
}

function diff(start: number | null, end: number | null) {
  if (start === null || end === null) return null;
  return Math.max(0, end - start);
}

function csvSafe(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csv(columns: readonly string[], rows: CsvRow[]) {
  return stringify(
    rows.map((row) => Object.fromEntries(columns.map((column) => [column, csvSafe(row[column])]))),
    { header: true, columns: [...columns] }
  );
}

export function countSerializedCsvDataRows(data: string) {
  const records = parse(data, {
    columns: false,
    skip_empty_lines: true
  }) as unknown[][];
  return Math.max(0, records.length - 1);
}

function serializedFileRecordCount(file: { path: string; data: string }) {
  if (file.path.endsWith(".csv")) {
    return countSerializedCsvDataRows(file.data);
  }
  return file.data.trim() ? 1 : 0;
}

function columnsFor(columns: readonly string[], includeRestricted: boolean) {
  return includeRestricted ? [...columns] : columns.filter((column) => !restrictedDefaultColumns.has(column));
}

function firstEvent(events: AnalysisSession["process_events"], types: string[]) {
  const typeSet = new Set(types);
  return events.find((event) => typeSet.has(event.event_type)) ?? null;
}

function lastEvent(events: AnalysisSession["process_events"], types: string[]) {
  const typeSet = new Set(types);
  return [...events].reverse().find((event) => typeSet.has(event.event_type)) ?? null;
}

function countEvents(events: AnalysisSession["process_events"], types: string[]) {
  const typeSet = new Set(types);
  return events.filter((event) => typeSet.has(event.event_type)).length;
}

function sumEventDuration(events: AnalysisSession["process_events"], field: "pause_duration_ms" | "visibility_duration_ms") {
  const values = events
    .map((event) => event[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function maxEventDuration(events: AnalysisSession["process_events"], field: "pause_duration_ms" | "visibility_duration_ms") {
  const values = events
    .map((event) => event[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function payloadString(payload: unknown, keys: string[]) {
  const record = asRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function payloadNumber(payload: unknown, keys: string[]) {
  const record = asRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function payloadBoolean(payload: unknown, keys: string[]) {
  const record = asRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function sourceRefString(sourceRef: unknown, keys: string[]) {
  return payloadString(sourceRef, keys);
}

function jsonString(value: unknown) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function sha(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function authorizedSessionOr(teacherUserDbId: string): Prisma.AssessmentSessionWhereInput[] {
  return [
    { assessment: { created_by_user_db_id: teacherUserDbId } },
    { user: { created_by_teacher_user_id: teacherUserDbId } }
  ];
}

function sessionWhere(input: {
  teacher_user_db_id: string;
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
  include_incomplete_sessions?: boolean;
}): Prisma.AssessmentSessionWhereInput {
  return {
    session_public_id: input.session_public_id,
    status: input.include_incomplete_sessions === false ? "completed" : undefined,
    assessment: { assessment_public_id: input.assessment_public_id },
    user: {
      role: "student",
      account_status: "active",
      user_id: input.student_user_id
    },
    OR: authorizedSessionOr(input.teacher_user_db_id)
  };
}

async function loadSessions(input: {
  teacher_user_db_id: string;
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
  include_incomplete_sessions?: boolean;
}) {
  return prisma.assessmentSession.findMany({
    where: sessionWhere(input),
    orderBy: [
      { assessment: { title: "asc" } },
      { user: { user_id: "asc" } },
      { attempt_number: "asc" },
      { created_at: "asc" }
    ],
    select: analysisSessionSelect
  });
}

async function loadSupplementalRecords(sessionPublicIds: string[]) {
  const [activityAttempts, evidenceRecords, snapshots] = await Promise.all([
    prisma.activityRuntimeAttempt.findMany({
      where: { session_public_id: { in: sessionPublicIds } },
      orderBy: [{ created_at: "asc" }]
    }),
    prisma.activityMisconceptionEvidenceRecord.findMany({
      where: { session_public_id: { in: sessionPublicIds } },
      orderBy: [{ created_at: "asc" }]
    }),
    prisma.postActivityDiagnosticSnapshot.findMany({
      where: { session_public_id: { in: sessionPublicIds } },
      orderBy: [{ created_at: "asc" }]
    })
  ]);

  return { activityAttempts, evidenceRecords, snapshots };
}

function sourceFor(input: {
  scope: string;
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
}) {
  return buildExportSourceIdentity({
    export_schema_version: ANALYSIS_READY_EXPORT_VERSION,
    export_scope: input.scope,
    selected_assessment_public_id: input.assessment_public_id,
    selected_student_id: input.student_user_id,
    selected_session_public_id: input.session_public_id
  });
}

function assessmentSnapshotId(session: AnalysisSession) {
  return `${session.assessment.assessment_public_id}:session:${session.session_public_id}`;
}

function itemSnapshotId(response: AnalysisSession["concept_unit_sessions"][number]["item_responses"][number]) {
  return `${response.item.item_public_id}:v${response.item_version_snapshot}`;
}

function itemSnapshotRecord(response: AnalysisSession["concept_unit_sessions"][number]["item_responses"][number]) {
  return asRecord(response.item_snapshot);
}

function packageEvidenceByItem(session: AnalysisSession) {
  const packages = session.concept_unit_sessions
    .flatMap((conceptUnitSession) => conceptUnitSession.response_packages)
    .filter((responsePackage) => responsePackage.package_type === "initial_concept_unit_response_package")
    .sort((left, right) => right.created_at.getTime() - left.created_at.getTime());
  const itemEvidence = asArray(asRecord(packages[0]?.payload).item_responses).map(asRecord);
  return new Map(itemEvidence.map((entry) => [String(entry.item_public_id ?? ""), entry]));
}

function mediaPublicIds(response: AnalysisSession["concept_unit_sessions"][number]["item_responses"][number]) {
  const snapshotMedia = asArray(itemSnapshotRecord(response).media_assets).map(asRecord);
  const fromSnapshot = snapshotMedia
    .map((entry) => {
      const id = typeof entry.media_public_id === "string" ? entry.media_public_id : null;
      const version = typeof entry.media_version === "number" ? entry.media_version : null;
      return id ? `${id}${version ? `:v${version}` : ""}` : null;
    })
    .filter((value): value is string => Boolean(value));
  if (fromSnapshot.length) return fromSnapshot.join(";");
  return response.item.media_assets
    .map((asset) => `${asset.media_public_id}:v${asset.media_version}`)
    .join(";");
}

function optionsByLabel(value: unknown) {
  const result = new Map<string, string>();
  for (const option of asArray(value).map(asRecord)) {
    const label = typeof option.label === "string" ? option.label.toUpperCase() : null;
    const text = typeof option.text === "string" ? option.text : null;
    if (label && text) result.set(label, text);
  }
  return result;
}

function latestProfile(session: AnalysisSession) {
  return session.concept_unit_sessions.flatMap((entry) => entry.student_profiles)[0] ?? null;
}

function evidenceProfileV2(profile: ReturnType<typeof latestProfile>) {
  const evidence = asRecord(profile?.item_level_evidence);
  const profileV2 = asRecord(evidence.evidence_integrated_profile_v2);
  return profileV2.profile_schema_version ? profileV2 : null;
}

function evidenceNextInteractionV2(profile: ReturnType<typeof latestProfile>) {
  const evidence = asRecord(profile?.item_level_evidence);
  const nextInteraction = asRecord(evidence.next_interaction_v2);
  return nextInteraction.next_interaction_schema_version ? nextInteraction : null;
}

function profileString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function nestedProfileValue(record: Record<string, unknown> | null, key: string) {
  const nested = asRecord(record?.[key]);
  return typeof nested.value === "string" ? nested.value : null;
}

function evidenceLimitationCodes(record: Record<string, unknown> | null) {
  const limitations = Array.isArray(record?.evidence_limitations)
    ? record.evidence_limitations
    : [];
  return limitations
    .map((entry) => asRecord(entry).code)
    .filter((code): code is string => typeof code === "string" && code.length > 0)
    .join("|") || null;
}

function growthTargetValue(record: Record<string, unknown> | null) {
  const target = asRecord(record?.growth_target).target;
  return typeof target === "string" ? target : null;
}

function answerRevealState(record: Record<string, unknown> | null) {
  return asRecord(asRecord(record?.outcome_summary).restricted_answer_reveal_state);
}

function studentSafeStatus(profile: ReturnType<typeof latestProfile>) {
  if (!profile) return null;
  const profileV2 = evidenceProfileV2(profile);
  const summary = asRecord(profileV2?.student_safe_summary);
  if (typeof summary.understanding_label === "string") {
    return summary.understanding_label;
  }
  switch (profile.integrated_diagnostic_profile) {
    case "robust_understanding_ready_for_transfer":
    case "underconfident_but_reasoning_supported":
      return "Mostly understood";
    case "insufficient_evidence_for_formative_decision":
    case "low_engagement_limits_interpretability":
      return "Needs more work";
    default:
      return "Still developing";
  }
}

function sessionBase(source: ExportSourceIdentity, session: AnalysisSession) {
  const responses = session.concept_unit_sessions.flatMap((entry) => entry.item_responses);
  const pseudonymousStudentId = researchStudentId(session.user.user_id);
  const pseudonymization = researchPseudonymizationMetadata();
  return {
    ...sourceIdentityRow(source),
    research_student_id: pseudonymousStudentId,
    student_id: pseudonymousStudentId,
    student_public_id: pseudonymousStudentId,
    research_pseudonym_version: pseudonymization.research_pseudonym_version,
    pseudonymization_method: pseudonymization.pseudonymization_method,
    pseudonymization_version: pseudonymization.research_pseudonym_version,
    pseudonymization_key_fingerprint: pseudonymization.pseudonymization_key_fingerprint,
    assessment_public_id: session.assessment.assessment_public_id,
    assessment_snapshot_public_id: assessmentSnapshotId(session),
    session_public_id: session.session_public_id,
    attempt_number: session.attempt_number,
    context_schema_version: "assessment-session-context-v1",
    assessment_context_hash: sha({
      assessment_public_id: session.assessment.assessment_public_id,
      session_public_id: session.session_public_id,
      item_snapshots: responses.map((response) => response.item_snapshot)
    }),
    assessment_title: session.assessment.title,
    assessment_status: session.assessment.status,
    folder_week_module: session.assessment.folder_label ?? null,
    release_at: iso(session.assessment.release_at),
    close_at: iso(session.assessment.close_at)
  };
}

function sessionRows(source: ExportSourceIdentity, sessions: AnalysisSession[], supplemental: SupplementalRecords) {
  const formativeConversationSessionIds = new Set(
    sessions
      .filter((session) => session.formative_conversation_sessions.length > 0)
      .map((session) => session.session_public_id)
  );
  const activityCounts = new Map<string, number>();
  for (const activity of supplemental.activityAttempts) {
    if (formativeConversationSessionIds.has(activity.session_public_id)) {
      continue;
    }
    activityCounts.set(activity.session_public_id, (activityCounts.get(activity.session_public_id) ?? 0) + 1);
  }
  const evidenceCounts = new Map<string, number>();
  for (const evidence of supplemental.evidenceRecords) {
    evidenceCounts.set(evidence.session_public_id, (evidenceCounts.get(evidence.session_public_id) ?? 0) + 1);
  }
  const snapshotCounts = new Map<string, number>();
  for (const snapshot of supplemental.snapshots) {
    snapshotCounts.set(snapshot.session_public_id, (snapshotCounts.get(snapshot.session_public_id) ?? 0) + 1);
  }

  return sessions.map((session) => {
    const responses = session.concept_unit_sessions.flatMap((entry) => entry.item_responses);
    const sessionEvents = session.process_events;
    const initialResponses = responses.filter((response) => response.item.item_order <= 3);
    const longPauseEvents = session.process_events.filter((event) => event.event_type === "long_pause");
    const idleEvents = session.process_events.filter((event) =>
      ["long_pause", "inactivity_detected"].includes(event.event_type)
    );
    const totalIdle = sumEventDuration(idleEvents, "pause_duration_ms");
    const elapsed = diff(ms(session.started_at ?? session.created_at), ms(session.completed_at ?? session.last_activity_at ?? session.updated_at));
    const sessionTiming = deriveSessionTiming({
      session_started_at: session.started_at ?? session.created_at,
      session_completed_at: session.completed_at,
      last_activity_at: session.last_activity_at,
      updated_at: session.updated_at,
      events: session.process_events
    });
    const activeTime = sessionTiming.session_active_interaction_time_ms;
    const profile = latestProfile(session);
    const profileV2 = evidenceProfileV2(profile);
    const nextInteraction = evidenceNextInteractionV2(profile);
    const revealState = answerRevealState(profileV2);
    const profileEvidence = asRecord(profile?.item_level_evidence);
    const unsupportedCorrectCount = responses.filter((response) => {
      const evidence = packageEvidenceByItem(session).get(response.item.item_public_id);
      return asRecord(evidence).unsupported_correct_response === true;
    }).length;
    const activityAttempts = supplemental.activityAttempts.filter(
      (activity) => activity.session_public_id === session.session_public_id
    );
    const latestActivityAttempt = activityAttempts.at(-1) ?? null;
    const usesFormativeConversation =
      session.formative_conversation_sessions.length > 0;
    const activeActivityAttempt = usesFormativeConversation
      ? null
      : latestActivityAttempt;
    const activitySkippedEvent = lastEvent(sessionEvents, ["formative_activity_skipped"]);
    const teacherEndedEvent = lastEvent(sessionEvents, ["attempt_ended_by_teacher"]);
    const studentEndedEvent = lastEvent(sessionEvents, ["attempt_ended_by_student"]);
    const completionEvent = lastEvent(sessionEvents, [
      "assessment_completed",
      "assessment_completed_with_unresolved_evidence",
      "session_completed"
    ]);
    const attemptStartedEvent = firstEvent(sessionEvents, ["attempt_started"]);
    const teacherOverrideMetadata = teacherEndedEvent
      ? {
          request_id: payloadString(teacherEndedEvent.payload, ["request_id"]),
          terminal_status: payloadString(teacherEndedEvent.payload, ["terminal_status"]),
          override_applied: payloadBoolean(teacherEndedEvent.payload, ["override_applied"])
        }
      : null;
    const attemptLifecycleStatus =
      session.status === "completed" || session.current_phase === "session_completed" || session.completed_at
        ? "completed"
        : teacherEndedEvent
          ? "ended_by_teacher"
          : studentEndedEvent || session.status === "student_exited" || session.current_phase === "student_exited"
            ? "ended_by_student"
            : session.status === "paused"
              ? "paused"
              : session.status === "active"
                ? "active"
                : session.status;
    const terminalReason =
      attemptLifecycleStatus === "completed"
        ? "completed"
        : attemptLifecycleStatus === "ended_by_teacher"
          ? "ended_by_teacher"
          : attemptLifecycleStatus === "ended_by_student"
            ? "ended_by_student"
            : attemptLifecycleStatus === "paused"
              ? "paused"
              : null;
    const formativeActivityCompletionStatus =
      activeActivityAttempt?.status === "move_on_recommended"
        ? "skipped"
        : activeActivityAttempt?.completed_at
          ? "completed"
          : activeActivityAttempt?.status ?? null;
    const packageCompletionEvent = lastEvent(sessionEvents, ["package_completion_operation_completed"]);
    const recoveryEvent = lastEvent(sessionEvents, ["package_completion_reconciled"]);
    const displayAckEvent = lastEvent(sessionEvents, [
      "package_results_shown",
      "profile_feedback_shown",
      "next_interaction_shown",
      "formative_activity_shown"
    ]);
    const answerReviewDisplayAckEvent = lastEvent(sessionEvents, ["package_results_shown"]);
    const nextInteractionTurn = [...session.conversation_turns].reverse().find((turn) => {
      const payload = asRecord(turn.structured_payload);
      return payload.message_type === "next_interaction";
    });
    const canonicalRuntimeState =
      usesFormativeConversation
        ? "FORMATIVE_CONVERSATION"
        : session.current_phase === "planning_completed" &&
            activeActivityAttempt?.status === "awaiting_student_activity_response"
        ? "AWAIT_FORMATIVE_ACTIVITY_RESPONSE"
        : session.current_phase;
    const conflictRecoveryMetadata = {
      package_completion_event: packageCompletionEvent
        ? {
            operation_public_id: payloadString(packageCompletionEvent.payload, ["operation_public_id"]),
            workflow_stage: payloadString(packageCompletionEvent.payload, ["workflow_stage"]),
            recovery_status: payloadString(packageCompletionEvent.payload, ["recovery_status"]),
            already_completed: payloadBoolean(packageCompletionEvent.payload, ["already_completed"])
          }
        : null,
      recovery_event: recoveryEvent
        ? {
            recovered_stages: asRecord(recoveryEvent.payload).recovered_stages ?? null,
            reason: payloadString(recoveryEvent.payload, ["reason"])
          }
        : null
    };
    return {
      ...sessionBase(source, session),
      session_status: session.status,
      current_phase: session.current_phase,
      started_at: iso(session.started_at),
      last_activity_at: iso(session.last_activity_at),
      completed_at: iso(session.completed_at),
      resumed_at: iso(firstEvent(session.process_events, ["session_resumed"])?.occurred_at ?? null),
      exited_at: iso(firstEvent(session.process_events, ["session_exited"])?.occurred_at ?? null),
      attempt_lifecycle_status: attemptLifecycleStatus,
      terminal_reason: terminalReason,
      ended_by_actor:
        attemptLifecycleStatus === "ended_by_teacher"
          ? "teacher"
          : attemptLifecycleStatus === "ended_by_student"
            ? "student"
            : null,
      pause_count: countEvents(sessionEvents, ["attempt_paused", "session_paused"]),
      resume_count: countEvents(sessionEvents, ["attempt_resumed", "session_resumed"]),
      last_runtime_state: usesFormativeConversation
        ? "FORMATIVE_CONVERSATION"
        : activeActivityAttempt?.status ?? null,
      formative_activity_completion_status: formativeActivityCompletionStatus,
      activity_skip_reason: activitySkippedEvent
        ? payloadString(activitySkippedEvent.payload, ["skip_reason", "reason"]) ?? "student_selected_skip_activity"
        : null,
      selected_navigation_destination: payloadString(activitySkippedEvent?.payload, [
        "selected_navigation_destination",
        "destination_type"
      ]),
      assessment_completion_reason:
        completionEvent?.event_type ??
        (attemptLifecycleStatus === "completed" ? "session_completed" : terminalReason),
      attempt_policy_version:
        payloadString(attemptStartedEvent?.payload, ["attempt_policy_version"]) ??
        "assessment-attempt-policy-v1",
      teacher_override_metadata: jsonString(teacherOverrideMetadata),
      actual_initial_item_count: initialResponses.length,
      completed_initial_item_count: initialResponses.filter((response) => response.item_submitted_at).length,
      current_item_index: responses.length ? Math.max(...responses.map((response) => response.item.item_order)) : null,
      session_completion_status: session.status,
      session_limitations: responses.length ? "" : "no_item_responses_recorded",
      session_wall_clock_elapsed_ms: sessionTiming.session_wall_clock_elapsed_ms,
      session_resumable_active_window_ms: sessionTiming.session_resumable_active_window_ms,
      session_visible_window_ms: sessionTiming.session_visible_window_ms,
      session_active_interaction_time_ms: sessionTiming.session_active_interaction_time_ms,
      session_idle_time_ms: sessionTiming.session_idle_time_ms,
      active_interaction_time_ms: activeTime,
      elapsed_session_time_ms: elapsed,
      timing_metric_available: elapsed !== null,
      timing_metric_type: elapsed !== null ? "legacy_elapsed_session_time" : null,
      total_idle_time_ms: totalIdle,
      total_page_hidden_ms: sessionTiming.total_page_hidden_ms,
      page_hidden_interval_count: sessionTiming.page_hidden_interval_count,
      page_hidden_timing_quality_status: sessionTiming.page_hidden_timing_quality_status,
      idle_ratio: elapsed && totalIdle !== null ? Number((totalIdle / elapsed).toFixed(4)) : null,
      long_pause_count: longPauseEvents.length,
      total_long_pause_ms: sumEventDuration(longPauseEvents, "pause_duration_ms"),
      maximum_long_pause_ms: maxEventDuration(longPauseEvents, "pause_duration_ms"),
      timing_contract_version: sessionTiming.timing_contract_version,
      timing_source_version: sessionTiming.timing_source_version,
      timing_quality_status: sessionTiming.timing_quality_status,
      timing_limitations: timingLimitationsText(sessionTiming.timing_limitations),
      derived_at: source.export_generated_at,
      instrumentation_complete: sessionTiming.instrumentation_complete,
      item_response_count: responses.length,
      process_event_count: session.process_events.length,
      conversation_turn_count: session.conversation_turns.length,
      agent_call_count: session.agent_calls.length,
      total_input_tokens: session.agent_calls.reduce((total, call) => total + (call.input_tokens ?? 0), 0),
      total_output_tokens: session.agent_calls.reduce((total, call) => total + (call.output_tokens ?? 0), 0),
      total_tokens: session.agent_calls.reduce((total, call) => total + (call.total_tokens ?? 0), 0),
      formative_activity_attempt_count: activityCounts.get(session.session_public_id) ?? 0,
      post_activity_evidence_count: evidenceCounts.get(session.session_public_id) ?? 0,
      diagnostic_snapshot_count: snapshotCounts.get(session.session_public_id) ?? 0,
      assessment_specific_understanding_category:
        nestedProfileValue(profileV2, "assessment_specific_understanding") ??
        profile?.integrated_diagnostic_profile ??
        null,
      reasoning_quality_category: nestedProfileValue(profileV2, "reasoning_quality"),
      confidence_calibration_category: nestedProfileValue(profileV2, "confidence_calibration"),
      evidence_limitation_codes: evidenceLimitationCodes(profileV2),
      growth_target: growthTargetValue(profileV2),
      answer_reveal_policy:
        typeof revealState.answer_reveal_policy === "string"
          ? revealState.answer_reveal_policy
          : null,
      correctness_status_reveal_policy:
        typeof revealState.correctness_status_reveal_policy === "string"
          ? revealState.correctness_status_reveal_policy
          : null,
      next_interaction_type: usesFormativeConversation
        ? null
        : profileString(nextInteraction, "interaction_type"),
      package_completion_operation_id: payloadString(packageCompletionEvent?.payload, ["operation_public_id"]),
      package_completion_workflow_stage: payloadString(packageCompletionEvent?.payload, ["workflow_stage"]),
      package_completion_recovery_status: payloadString(packageCompletionEvent?.payload, ["recovery_status"]),
      canonical_runtime_state: canonicalRuntimeState,
      active_next_interaction_id:
        !usesFormativeConversation && nextInteractionTurn
          ? `${session.session_public_id}:turn:${nextInteractionTurn.created_at.toISOString()}`
          : null,
      active_activity_id:
        activeActivityAttempt?.activity_attempt_public_id ?? null,
      display_acknowledgement: displayAckEvent ? "acknowledged" : "not_acknowledged",
      display_event_contract_version: payloadString(displayAckEvent?.payload, ["display_event_contract_version"]),
      answer_review_display_acknowledgement: answerReviewDisplayAckEvent ? "acknowledged" : "not_acknowledged",
      answer_review_display_event_contract_version: payloadString(answerReviewDisplayAckEvent?.payload, [
        "display_event_contract_version"
      ]),
      conflict_recovery_metadata: jsonString(conflictRecoveryMetadata),
      activity_type: usesFormativeConversation
        ? null
        : profileString(nextInteraction, "activity_type"),
      routing_policy_version: usesFormativeConversation
        ? null
        : profileString(nextInteraction, "routing_policy_version"),
      activity_taxonomy_version: usesFormativeConversation
        ? null
        : profileString(nextInteraction, "activity_taxonomy_version"),
      evidence_profile_schema_version: profileString(profileV2, "profile_schema_version"),
      effective_evidence_package_hash:
        typeof profileEvidence.effective_evidence_package_hash === "string"
          ? profileEvidence.effective_evidence_package_hash
          : null,
      engagement_review_category: profile?.engagement_profile ?? null,
      latest_student_safe_status: studentSafeStatus(profile),
      evidence_sufficiency: profile?.evidence_sufficiency ?? null,
      interpretation_limitations: profile
        ? "interpretive_assessment_specific_signal_not_stable_trait"
        : "no_valid_profile_output_recorded",
      unsupported_correct_response_count: unsupportedCorrectCount,
      estimated_guessing_risk_max: null
    } satisfies CsvRow;
  });
}

function itemResponseRows(source: ExportSourceIdentity, sessions: AnalysisSession[], includeRestricted: boolean) {
  const rows: CsvRow[] = [];
  for (const session of sessions) {
    const packageEvidence = packageEvidenceByItem(session);
    for (const conceptUnitSession of session.concept_unit_sessions) {
      for (const response of conceptUnitSession.item_responses) {
        const itemEvents = session.process_events.filter((event) => event.item?.item_public_id === response.item.item_public_id);
        const evidence = asRecord(packageEvidence.get(response.item.item_public_id));
        const timing = deriveItemTiming({
          events: itemEvents,
          item_started_at: response.item_started_at,
          item_submitted_at: response.item_submitted_at,
          persisted_item_response_time_ms: response.item_response_time_ms
        });
        const row: CsvRow = {
          session_public_id: session.session_public_id,
          attempt_number: session.attempt_number,
          research_student_id: researchStudentId(session.user.user_id),
          student_id: researchStudentId(session.user.user_id),
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          item_public_id: response.item.item_public_id,
          item_snapshot_public_id: itemSnapshotId(response),
          item_version: response.item_version_snapshot,
          item_order: response.item.item_order,
          response_public_id: `${session.session_public_id}:${response.item.item_public_id}:response`,
          media_snapshot_public_ids: mediaPublicIds(response),
          selected_option: response.selected_option,
          reasoning_text: response.reasoning_text,
          confidence_rating: response.confidence_rating,
          tempting_option: typeof evidence.tempting_option === "string" ? evidence.tempting_option : null,
          tempting_option_reason: typeof evidence.tempting_option_reason === "string" ? evidence.tempting_option_reason : null,
          insufficient_knowledge_selected: countEvents(itemEvents, ["idk_selected", "insufficient_knowledge_marked"]) > 0,
          skipped_item: response.skipped_item,
          skipped_reasoning: response.skipped_reasoning,
          skipped_confidence: response.skipped_confidence,
          response_finalized: Boolean(response.item_submitted_at),
          answer_explanation_revealed: response.answer_explanation_revealed,
          revealed_at: iso(response.revealed_at),
          reveal_trigger: response.reveal_trigger,
          explanation_version: response.explanation_version,
          student_display_acknowledged_at: iso(response.student_display_acknowledged_at),
          submitted_at: iso(response.item_submitted_at),
          revised_at: response.revision_count > 0 ? iso(response.updated_at) : null,
          revision_count: response.revision_count,
          item_presented_at: iso(timing.item_presented_at),
          first_student_action_at: iso(timing.first_student_action_at),
          time_to_first_action_ms: timing.time_to_first_response_action_ms,
          time_to_first_response_action_ms: timing.time_to_first_response_action_ms,
          first_option_selected_at: iso(timing.first_option_selected_at),
          time_to_first_option_selection_ms: timing.time_to_first_option_selection_ms,
          post_option_completion_time_ms: timing.post_option_completion_time_ms,
          reasoning_prompted_at: iso(timing.reasoning_prompted_at),
          reasoning_started_at: iso(timing.reasoning_started_at),
          reasoning_submitted_at: iso(timing.reasoning_submitted_at),
          reasoning_prompt_to_submission_ms: timing.reasoning_elapsed_time_ms,
          reasoning_elapsed_time_ms: timing.reasoning_elapsed_time_ms,
          reasoning_active_time_ms: timing.reasoning_active_typing_time_ms,
          reasoning_active_typing_time_ms: timing.reasoning_active_typing_time_ms,
          reasoning_input_elapsed_time_ms: timing.reasoning_input_elapsed_time_ms,
          confidence_prompted_at: iso(timing.confidence_prompted_at),
          confidence_selected_at: iso(timing.confidence_selected_at),
          confidence_prompt_to_selection_ms: timing.confidence_response_time_ms,
          confidence_response_time_ms: timing.confidence_response_time_ms,
          tempting_option_prompted_at: iso(timing.tempting_option_prompted_at),
          tempting_option_submitted_at: iso(timing.tempting_option_submitted_at),
          tempting_option_response_time_ms: timing.tempting_option_response_time_ms,
          last_student_action_at: iso(timing.last_student_action_at),
          item_submitted_at: iso(timing.item_submitted_at),
          last_action_to_submission_ms: timing.last_action_to_submission_ms,
          item_elapsed_response_time_ms: timing.item_elapsed_response_time_ms,
          item_response_time_ms: response.item_response_time_ms,
          timing_contract_version: timing.timing_contract_version,
          timing_source_version: timing.timing_source_version,
          timing_quality_status: timing.timing_quality_status,
          timing_limitations: timingLimitationsText(timing.timing_limitations),
          derived_at: source.export_generated_at,
          instrumentation_complete: timing.instrumentation_complete,
          option_selection_count: countEvents(itemEvents, ["option_clicked", "option_selected", "transfer_answer_selected"]),
          option_revision_count: countEvents(itemEvents, ["answer_changed"]),
          reasoning_submission_count: countEvents(itemEvents, ["reasoning_submitted", "transfer_reasoning_submitted"]),
          reasoning_revision_count: countEvents(itemEvents, ["reasoning_revised", "reasoning_edited"]),
          confidence_selection_count: countEvents(itemEvents, ["confidence_clicked", "confidence_selected", "transfer_confidence_clicked"]),
          confidence_revision_count: countEvents(itemEvents, ["confidence_changed"]),
          navigation_event_count: countEvents(itemEvents, ["navigation_event"]),
          page_hidden_count: countEvents(itemEvents, ["page_hidden", "page_visibility_hidden"]),
          typing_activity_event_count: countEvents(itemEvents, ["typing_activity_summary"]),
          response_quality_check_count: countEvents(itemEvents, ["response_quality_checked"]),
          response_quality_rejection_count: countEvents(itemEvents, ["response_quality_rejected"]),
          insufficient_knowledge_count: countEvents(itemEvents, ["idk_selected", "insufficient_knowledge_marked"]),
          procedural_clarification_count: countEvents(itemEvents, ["procedural_clarification_request", "clarification_answered"]),
          content_question_count: countEvents(itemEvents, ["content_question_deferred"]),
          invalid_help_request_count: countEvents(itemEvents, ["invalid_help_request"]),
          reasoning_quality_signal: typeof evidence.response_quality_summary === "string" ? evidence.response_quality_summary : null,
          observed_evidence_summary: typeof evidence.observed_evidence_summary === "string" ? evidence.observed_evidence_summary : null,
          misconception_hypothesis: typeof evidence.misconception_hypothesis === "string" ? evidence.misconception_hypothesis : null,
          alternative_explanations: typeof evidence.alternative_explanations === "string" ? evidence.alternative_explanations : null,
          evidence_sufficiency: typeof evidence.evidence_sufficiency === "string" ? evidence.evidence_sufficiency : null,
          interpretation_limitations: "item interpretation fields are provisional and depend on available package/profile evidence",
          teacher_diagnostic_guidance_available: Boolean(asRecord(response.item_snapshot).teacher_diagnostic_context),
          teacher_guidance_considered: Boolean(asRecord(response.item_snapshot).teacher_diagnostic_context),
          diagnostic_snapshot_before: null,
          diagnostic_snapshot_after: null
        };
        if (includeRestricted) {
          row.correct_option = response.correct_option_snapshot;
          row.correctness = response.correctness;
          row.correctness_support_level = typeof evidence.correctness_support_level === "string" ? evidence.correctness_support_level : null;
          row.unsupported_correct_response = evidence.unsupported_correct_response === true;
          row.estimated_guessing_risk = typeof evidence.estimated_guessing_risk === "string" ? evidence.estimated_guessing_risk : null;
          row.answer_selection_evidence_weight =
            typeof evidence.answer_selection_evidence_weight === "string" ? evidence.answer_selection_evidence_weight : null;
        }
        rows.push(row);
      }
    }
  }
  return rows;
}

function assessmentSummaryRows(source: ExportSourceIdentity, sessions: AnalysisSession[], supplemental: SupplementalRecords) {
  const sessionRowsById = new Map(
    sessionRows(source, sessions, supplemental).map((row) => [String(row.session_public_id), row])
  );
  return sessions.map((session) => {
    const row = sessionRowsById.get(session.session_public_id);
    if (!row) {
      throw new Error(`Missing session summary row for ${session.session_public_id}.`);
    }
    return {
      research_student_id: row.research_student_id,
      student_id: row.student_id,
      student_public_id: row.student_public_id,
      research_pseudonym_version: row.research_pseudonym_version,
      pseudonymization_method: row.pseudonymization_method,
      pseudonymization_version: row.pseudonymization_version,
      pseudonymization_key_fingerprint: row.pseudonymization_key_fingerprint,
      assessment_public_id: row.assessment_public_id,
      assessment_title: row.assessment_title,
      session_public_id: row.session_public_id,
      attempt_number: row.attempt_number,
      session_status: row.session_status ?? session.status,
      completion_status: row.session_completion_status ?? session.status,
      started_at: row.started_at ?? iso(session.started_at),
      completed_at: row.completed_at ?? iso(session.completed_at),
      item_response_count: row.item_response_count ?? 0,
      completed_initial_item_count: row.completed_initial_item_count ?? 0,
      process_event_count: row.process_event_count ?? session.process_events.length,
      conversation_turn_count: row.conversation_turn_count ?? session.conversation_turns.length,
      agent_call_count: row.agent_call_count ?? session.agent_calls.length,
      formative_activity_attempt_count: row.formative_activity_attempt_count ?? 0,
      latest_student_safe_status: row.latest_student_safe_status ?? null,
      assessment_specific_understanding_category: row.assessment_specific_understanding_category ?? null,
      reasoning_quality_category: row.reasoning_quality_category ?? null,
      confidence_calibration_category: row.confidence_calibration_category ?? null,
      growth_target: row.growth_target ?? null,
      next_interaction_type: row.next_interaction_type ?? null,
      activity_type: row.activity_type ?? null,
      engagement_review_category: row.engagement_review_category ?? null,
      evidence_sufficiency: row.evidence_sufficiency ?? null,
      elapsed_session_time_ms: row.elapsed_session_time_ms ?? null,
      active_interaction_time_ms: row.active_interaction_time_ms ?? null,
      unsupported_correct_response_count: row.unsupported_correct_response_count ?? 0,
      estimated_guessing_risk_max: row.estimated_guessing_risk_max ?? null,
      summary_limitations: "assessment_specific_summary_not_psychometric_ability_estimate"
    } satisfies CsvRow;
  });
}

function processEventRows(sessions: AnalysisSession[]) {
  return sessions.flatMap((session) =>
    {
      const visibilityIntervals = deriveVisibilityIntervals(session.process_events);
      const visibilityByStart = new Map(
        visibilityIntervals.map((interval) => [interval.start_at.getTime(), interval])
      );
      return session.process_events.map((event, index) => {
      const payload = asRecord(event.payload);
      const duration = event.pause_duration_ms ?? event.visibility_duration_ms ?? payloadNumber(payload, ["duration_ms"]);
      const timestamp = eventTimestamp(event);
      const visibilityInterval = timestamp ? visibilityByStart.get(timestamp.getTime()) : undefined;
      return {
        event_public_id: `${session.session_public_id}:event:${index + 1}`,
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        student_id: researchStudentId(session.user.user_id),
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_snapshot_public_id: assessmentSnapshotId(session),
        item_public_id: event.item?.item_public_id ?? null,
        item_snapshot_public_id: event.item ? `${event.item.item_public_id}:event` : null,
        event_sequence_index: index + 1,
        event_type: event.event_type,
        event_category: event.event_category,
        event_source: event.event_source,
        phase: payloadString(payload, ["phase"]),
        occurred_at: iso(event.occurred_at),
        created_at: iso(event.created_at),
        client_occurred_at: payloadString(payload, ["client_occurred_at"]),
        server_received_at: payloadString(payload, ["server_received_at"]),
        persisted_at: iso(event.created_at),
        clock_source: payloadString(payload, ["clock_source"]) ?? (event.event_source === "frontend" ? "server_received" : "backend"),
        timing_contract_version: payloadString(payload, ["timing_contract_version"]) ?? TIMING_CONTRACT_VERSION,
        timing_source_version: payloadString(payload, ["timing_source_version"]) ?? TIMING_SOURCE_VERSION,
        timing_quality_status: payloadString(payload, ["timing_quality_status"]),
        item_position: event.item?.item_order ?? null,
        actual_total_item_count: session.concept_unit_sessions.flatMap((entry) => entry.item_responses).length,
        payload_source: payloadString(payload, ["source"]),
        payload_action_status: payloadString(payload, ["action_status", "status"]),
        payload_prompt_type: payloadString(payload, ["prompt_type", "message_type"]),
        payload_text_length: payloadNumber(payload, ["text_length", "message_length", "reasoning_length"]),
        payload_selected_option: payloadString(payload, ["selected_option", "option", "answer"]),
        payload_confidence_rating: payloadString(payload, ["confidence_rating", "confidence"]),
        payload_no_tempting_option: payload.no_tempting_option === true,
        duration_ms: duration,
        visibility_duration_ms: event.visibility_duration_ms,
        visibility_interval_start_at: iso(visibilityInterval?.start_at ?? null),
        visibility_interval_end_at: iso(visibilityInterval?.end_at ?? null),
        visibility_interval_duration_ms: visibilityInterval?.duration_ms ?? null,
        visibility_interval_quality_status: visibilityInterval?.quality_status ?? null,
        pause_duration_ms: event.pause_duration_ms,
        limitation_code: "raw_payload_excluded"
      } satisfies CsvRow;
    })
    }
  );
}

function conversationRows(sessions: AnalysisSession[]) {
  return sessions.flatMap((session) =>
    session.conversation_turns.map((turn, index) => {
      const nextStudentTurn = session.conversation_turns
        .slice(index + 1)
        .find((candidate) => candidate.actor_type === "student");
      const promptLatency =
        turn.actor_type !== "student" && nextStudentTurn ? diff(ms(turn.created_at), ms(nextStudentTurn.created_at)) : null;
      return {
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        student_id: researchStudentId(session.user.user_id),
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_snapshot_public_id: assessmentSnapshotId(session),
        item_public_id: turn.item?.item_public_id ?? null,
        turn_index: index + 1,
        actor_type: turn.actor_type,
        actor_name: turn.actor_type === "agent" ? turn.agent_name ?? "assessment_agent" : turn.actor_type,
        phase: turn.phase,
        context_label:
          turn.item?.item_public_id ??
          turn.concept_unit_session?.concept_unit.concept_unit_public_id ??
          "session",
        created_at: iso(turn.created_at),
        message_text: turn.message_text,
        response_or_action_latency_ms: promptLatency,
        prompt_to_student_action_latency_ms: promptLatency,
        latency_recorded_on_turn: turn.actor_type !== "student" ? "prompt_turn" : "not_applicable",
        response_text_present: Boolean(turn.message_text?.trim()),
        turn_status: "recorded",
        limitation_code: "structured_payload_excluded"
      } satisfies CsvRow;
    })
  );
}

function agentAndActivityRows(sessions: AnalysisSession[], supplemental: SupplementalRecords) {
  const rows: CsvRow[] = [];
  const formativeConversationSessionIds = new Set(
    sessions
      .filter((session) => session.formative_conversation_sessions.length > 0)
      .map((session) => session.session_public_id)
  );
  const activitySwitchCountsBySession = new Map<string, number>();
  for (const activity of supplemental.activityAttempts) {
    const sourceRef = asRecord(activity.source_activity_packet_ref);
    if (typeof sourceRef.replaced_activity_attempt_public_id === "string" && sourceRef.replaced_activity_attempt_public_id.trim()) {
      activitySwitchCountsBySession.set(
        activity.session_public_id,
        (activitySwitchCountsBySession.get(activity.session_public_id) ?? 0) + 1
      );
    }
  }
  for (const session of sessions) {
    for (const call of session.agent_calls) {
      rows.push({
        record_type: "agent_call",
        authority_status: "authoritative_operational_record",
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        student_id: researchStudentId(session.user.user_id),
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_snapshot_public_id: assessmentSnapshotId(session),
        item_snapshot_public_id: null,
        agent_call_public_id: call.agent_call_public_id,
        agent_name: call.agent_name,
        provider: call.provider,
        model: call.model_name,
        status: call.call_status,
        blocked_reason: call.blocked_reason,
        started_at: iso(call.started_at ?? call.created_at),
        completed_at: iso(call.completed_at),
        retry_count: call.retry_count,
        input_token_count: call.input_tokens,
        output_token_count: call.output_tokens,
        total_token_count: call.total_tokens,
        prompt_version: call.prompt_version,
        schema_version: call.schema_version,
        output_validated: call.output_validated,
        repair_attempted: Boolean(call.validation_error),
        repair_status: call.validation_error ? "validation_error_recorded" : null,
        context_schema_version: "assessment-session-context-v1",
        assessment_context_hash: sha({ session_public_id: session.session_public_id, agent_name: call.agent_name }),
        teacher_diagnostic_context_present: null,
        interpretation_caution_present: true,
        student_evidence_present: true,
        context_version_bound: true,
        answer_key_internal_only: true,
        protected_content_exposed: false,
        limitations: call.validation_error ? "validation_error_sanitized" : null
      });
    }

    for (const conceptUnitSession of session.concept_unit_sessions) {
      for (const profile of conceptUnitSession.student_profiles) {
        rows.push({
          record_type: "profile_result",
          authority_status: "authoritative_profile_record",
          session_public_id: session.session_public_id,
          research_student_id: researchStudentId(session.user.user_id),
          student_id: researchStudentId(session.user.user_id),
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          understanding_category: profile.integrated_diagnostic_profile,
          engagement_category: profile.engagement_profile,
          response_profile: profile.ability_profile,
          evidence_sufficiency: profile.evidence_sufficiency,
          uncertainty: profile.profile_type === "updated" ? "updated_profile" : "initial_profile",
          status: "recorded",
          started_at: iso(profile.created_at),
          completed_at: iso(profile.created_at),
          limitations: "interpretive_assessment_specific_profile"
        });
      }
      for (const decision of conceptUnitSession.formative_decisions) {
        rows.push({
          record_type: "formative_decision",
          authority_status: "authoritative_legacy_decision",
          session_public_id: session.session_public_id,
          research_student_id: researchStudentId(session.user.user_id),
          student_id: researchStudentId(session.user.user_id),
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          formative_value: decision.formative_value,
          selected_strategy: decision.mapping_followed ? "mapped_strategy" : "mapped_with_deviation",
          status: "recorded",
          started_at: iso(decision.created_at),
          completed_at: iso(decision.created_at),
          limitations: decision.mapping_deviation_reason
        });
      }
      for (const followup of conceptUnitSession.followup_rounds) {
        rows.push({
          record_type: "legacy_followup_round",
          authority_status: "legacy_non_authoritative",
          session_public_id: session.session_public_id,
          research_student_id: researchStudentId(session.user.user_id),
          student_id: researchStudentId(session.user.user_id),
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          activity_public_id: `${session.session_public_id}:followup:${followup.round_index}`,
          activity_type: "followup_round",
          attempt_number: followup.round_index,
          status: followup.status,
          started_at: iso(followup.started_at ?? followup.created_at),
          completed_at: iso(followup.completed_at),
          limitations: followup.evidence_trigger_type
        });
      }
    }
    for (const job of session.workflow_jobs) {
      rows.push({
        record_type: "workflow_job",
        authority_status: "authoritative_operational_record",
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        student_id: researchStudentId(session.user.user_id),
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_snapshot_public_id: assessmentSnapshotId(session),
        activity_public_id: job.job_public_id,
        activity_type: job.job_type,
        status: job.status,
        retry_count: job.attempt_count,
        started_at: iso(job.created_at),
        completed_at: iso(job.completed_at),
        limitations: job.last_error_category ?? null
      });
    }
  }

  for (const activity of supplemental.activityAttempts) {
    const sourceRef = asRecord(activity.source_activity_packet_ref);
    rows.push({
      record_type: "formative_activity",
      authority_status: formativeConversationSessionIds.has(
        activity.session_public_id
      )
        ? "legacy_non_authoritative"
        : "authoritative_legacy_runtime",
      session_public_id: activity.session_public_id,
      research_student_id: researchStudentId(activity.student_public_id),
      student_id: researchStudentId(activity.student_public_id),
      assessment_public_id: activity.assessment_public_id,
      assessment_snapshot_public_id: `${activity.assessment_public_id}:session:${activity.session_public_id}`,
      activity_public_id: activity.activity_attempt_public_id,
      activity_type: activity.activity_family,
      diagnostic_purpose: activity.diagnostic_purpose,
      activity_target: activity.concept_unit_id,
      activity_source_item_id: sourceRefString(sourceRef, ["target_item_id"]),
      activity_source_option_label: sourceRefString(sourceRef, ["target_option_label"]),
      expected_response_mode: sourceRefString(sourceRef, ["expected_response_mode"]),
      activity_deduplication_key: sourceRefString(sourceRef, ["semantic_deduplication_key"]),
      activity_deduplication_version: sourceRefString(sourceRef, [
        "routing_policy_version",
        "runtime_loop_version",
        "next_interaction_schema_version"
      ]),
      activity_switch_count: activitySwitchCountsBySession.get(activity.session_public_id) ?? 0,
      activity_switch_history_reference: sourceRefString(sourceRef, ["replaced_activity_attempt_public_id"]),
      activity_switch_reason: sourceRefString(sourceRef, ["activity_switch_reason"]),
      activity_prompt: sourceRefString(activity.source_activity_packet_ref, ["safe_activity_prompt"]),
      attempt_number: 1,
      status: activity.status,
      started_at: iso(activity.started_at),
      completed_at: iso(activity.completed_at),
      limitations: payloadString(activity.limitations, ["summary", "code"])
    });
  }
  for (const evidence of supplemental.evidenceRecords) {
    rows.push({
      record_type: "post_activity_evidence",
      authority_status: formativeConversationSessionIds.has(
        evidence.session_public_id
      )
        ? "legacy_non_authoritative"
        : "authoritative_legacy_runtime",
      session_public_id: evidence.session_public_id,
      research_student_id: researchStudentId(evidence.student_public_id),
      student_id: researchStudentId(evidence.student_public_id),
      assessment_public_id: evidence.assessment_public_id,
      assessment_snapshot_public_id: `${evidence.assessment_public_id}:session:${evidence.session_public_id}`,
      activity_public_id: evidence.activity_attempt_id,
      diagnostic_purpose: evidence.diagnostic_purpose,
      activity_type: evidence.activity_family,
      evaluation_status: evidence.evaluation_source,
      misconception_persisted: evidence.misconception_update_status === "misconception_persisted",
      misconception_weakened: evidence.misconception_update_status === "misconception_weakened",
      misconception_changed: evidence.misconception_update_status === "misconception_changed",
      misconception_resolved: evidence.misconception_update_status === "misconception_resolved",
      evidence_insufficient: evidence.evidence_quality === "insufficient",
      next_action: evidence.recommended_next_diagnostic_purpose,
      status: "recorded",
      started_at: iso(evidence.created_at),
      completed_at: iso(evidence.created_at),
      limitations: payloadString(evidence.limitations, ["summary", "code"])
    });
  }
  for (const snapshot of supplemental.snapshots) {
    rows.push({
      record_type: "diagnostic_snapshot",
      authority_status: formativeConversationSessionIds.has(
        snapshot.session_public_id
      )
        ? "legacy_non_authoritative"
        : "authoritative_legacy_runtime",
      session_public_id: snapshot.session_public_id,
      research_student_id: researchStudentId(snapshot.student_public_id),
      student_id: researchStudentId(snapshot.student_public_id),
      assessment_public_id: snapshot.assessment_public_id,
      assessment_snapshot_public_id: `${snapshot.assessment_public_id}:session:${snapshot.session_public_id}`,
      activity_public_id: snapshot.activity_attempt_id,
      status: snapshot.activity_update_status,
      diagnostic_purpose: snapshot.next_diagnostic_purpose,
      evaluation_status: snapshot.evidence_quality,
      next_action: snapshot.next_diagnostic_purpose,
      started_at: iso(snapshot.created_at),
      completed_at: iso(snapshot.created_at),
      limitations: payloadString(snapshot.limitations, ["summary", "code"])
    });
  }
  return rows;
}

function assessmentContentRows(sessions: AnalysisSession[], includeRestricted: boolean) {
  const rows = new Map<string, CsvRow>();
  for (const session of sessions) {
    for (const conceptUnitSession of session.concept_unit_sessions) {
      for (const response of conceptUnitSession.item_responses) {
        const snapshot = itemSnapshotRecord(response);
        const options = optionsByLabel(snapshot.options ?? response.item.options);
        const media = response.item.media_assets;
        const key = `${session.session_public_id}:${response.item.item_public_id}:${response.item_version_snapshot}`;
        const row: CsvRow = {
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          assessment_title: session.assessment.title,
          assessment_diagnostic_focus: session.assessment.diagnostic_focus,
          folder_week_module: session.assessment.folder_label,
          item_public_id: response.item.item_public_id,
          item_snapshot_public_id: itemSnapshotId(response),
          item_version: response.item_version_snapshot,
          item_order: response.item.item_order,
          stem: typeof snapshot.item_stem === "string" ? snapshot.item_stem : response.item.item_stem,
          option_a_text: options.get("A") ?? null,
          option_b_text: options.get("B") ?? null,
          option_c_text: options.get("C") ?? null,
          option_d_text: options.get("D") ?? null,
          media_public_ids: mediaPublicIds(response),
          student_alt_text: media.map((asset) => asset.student_alt_text ?? asset.alt_text_or_description).filter(Boolean).join("; "),
          snapshot_created_at: iso(response.created_at)
        };
        if (includeRestricted) {
          row.teacher_llm_media_description = media
            .map((asset) => asset.teacher_llm_media_description)
            .filter(Boolean)
            .join("; ");
          row.target_reasoning_note = asArray(snapshot.expected_reasoning_patterns).join("; ");
          row.strong_reasoning_note = asArray(snapshot.expected_reasoning_patterns).join("; ");
          row.distractor_diagnostic_notes = JSON.stringify(snapshot.possible_misconception_indicators ?? response.item.possible_misconception_indicators ?? null);
          row.correct_option = response.correct_option_snapshot;
        }
        rows.set(key, row);
      }
    }
  }
  return [...rows.values()].sort((left, right) =>
    `${left.assessment_public_id}.${left.session_public_id ?? ""}.${left.item_order}`.localeCompare(
      `${right.assessment_public_id}.${right.session_public_id ?? ""}.${right.item_order}`
    )
  );
}

function formativeConversationSessionRows(sessions: AnalysisSession[]) {
  return sessions.flatMap((session) =>
    session.formative_conversation_sessions.map((conversation) => {
      const latestTransition =
        latestPersistedFormativeConversationProfileTransition(
          conversation.profile_transitions
        );
      const canonicalCurrentProfile =
        latestTransition?.updated_student_profile ??
        conversation.initial_student_profile;
      return {
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        assessment_public_id: session.assessment.assessment_public_id,
        concept_unit_public_id:
          conversation.concept_unit_session.concept_unit
            .concept_unit_public_id,
        conversation_public_id: conversation.conversation_public_id,
        conversation_status: conversation.status,
        started_at: iso(conversation.started_at),
        last_activity_at: iso(conversation.last_activity_at),
        paused_at: iso(conversation.paused_at),
        completed_at: iso(conversation.completed_at),
        ended_at: iso(conversation.ended_at),
        wall_clock_duration_ms: diff(
          ms(conversation.started_at),
          ms(
            conversation.completed_at ??
              conversation.ended_at ??
              conversation.last_activity_at
          )
        ),
        turn_count: conversation.conversation_turns.length,
        lifecycle_event_count: conversation.lifecycle_events.length,
        agent_call_count: conversation.agent_calls.length,
        intervention_count: conversation.interventions.length,
        profile_transition_count:
          conversation.profile_transitions.length,
        latest_profile_transition_public_id:
          latestTransition?.transition_public_id ?? null,
        validated_formative_outcome:
          persistedFormativeConversationOutcome(
            conversation.profile_transitions
          ),
        initial_learning_profile:
          conversation.initial_student_profile
            ?.integrated_diagnostic_profile ?? null,
        initial_profile_evidence_sufficiency:
          conversation.initial_student_profile?.evidence_sufficiency ??
          null,
        current_learning_profile:
          canonicalCurrentProfile?.integrated_diagnostic_profile ?? null,
        current_profile_evidence_sufficiency:
          canonicalCurrentProfile?.evidence_sufficiency ?? null
      };
    })
  );
}

function formativeConversationTurnRows(sessions: AnalysisSession[]) {
  return sessions.flatMap((session) =>
    session.formative_conversation_sessions.flatMap((conversation) =>
      conversation.conversation_turns.map((turn) => {
        const telemetry = turn.formative_conversation_turn_telemetry;
        const inputTelemetry = turn.formative_conversation_input_telemetry;
        const payload = asRecord(turn.structured_payload);
        return {
          session_public_id: session.session_public_id,
          research_student_id: researchStudentId(session.user.user_id),
          conversation_public_id: conversation.conversation_public_id,
          agent_call_public_id:
            telemetry?.agent_call?.agent_call_public_id ?? null,
          turn_sequence_index: turn.sequence_index,
          conversation_local_turn_sequence_index:
            telemetry?.conversation_local_turn_sequence_index ?? null,
          actor_type: turn.actor_type,
          actor_name:
            turn.actor_type === "agent"
              ? turn.agent_name ?? "formative_conversation_agent"
              : "student",
          message_text: turn.message_text,
          generation_source:
            typeof payload.generation_source === "string"
              ? payload.generation_source
              : null,
          validator_status:
            typeof payload.validator_status === "string"
              ? payload.validator_status
              : null,
          fallback_used:
            typeof payload.fallback_used === "boolean"
              ? payload.fallback_used
              : null,
          created_at: iso(turn.created_at),
          turn_started_at: iso(telemetry?.turn_started_at),
          turn_submitted_at: iso(telemetry?.turn_submitted_at),
          response_time_ms: telemetry?.response_time_ms ?? null,
          message_length_chars:
            telemetry?.message_length_chars ?? turn.message_text?.length ?? 0,
          input_token_count: telemetry?.input_token_count ?? null,
          output_token_count: telemetry?.output_token_count ?? null,
          typing_started_at: iso(inputTelemetry?.typing_started_at),
          typing_ended_at: iso(inputTelemetry?.typing_ended_at),
          typing_duration_ms: inputTelemetry?.typing_duration_ms ?? null,
          typing_duration_method:
            inputTelemetry?.typing_duration_method ?? null,
          edit_count: inputTelemetry?.edit_count ?? null,
          backspace_count: inputTelemetry?.backspace_count ?? null,
          paste_event_count: inputTelemetry?.paste_event_count ?? null,
          paste_character_count:
            inputTelemetry?.paste_character_count ?? null,
          final_message_length_chars:
            inputTelemetry?.final_message_length_chars ?? null
        };
      })
    )
  );
}

function formativeConversationEventRows(sessions: AnalysisSession[]) {
  return sessions.flatMap((session) =>
    session.formative_conversation_sessions.flatMap((conversation) =>
      conversation.lifecycle_events.map((event) => ({
        event_public_id: event.event_public_id,
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        conversation_public_id: conversation.conversation_public_id,
        event_sequence_index: event.sequence_index,
        conversation_local_event_sequence_index:
          event.conversation_local_event_sequence_index,
        event_type: event.event_type,
        event_source: event.event_source,
        observed_interval_duration_ms:
          event.observed_interval_duration_ms,
        occurred_at: iso(event.occurred_at),
        created_at: iso(event.created_at)
      }))
    )
  );
}

function formativeConversationLlmRows(sessions: AnalysisSession[]) {
  return sessions.flatMap((session) =>
    session.formative_conversation_sessions.flatMap((conversation) =>
      conversation.agent_calls.map((call, index) => ({
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        conversation_public_id: conversation.conversation_public_id,
        agent_call_public_id: call.agent_call_public_id,
        agent_call_index: index + 1,
        agent_name: call.agent_name,
        agent_version: call.agent_version,
        provider: call.provider,
        model_name: call.model_name,
        prompt_version: call.prompt_version,
        schema_version: call.schema_version,
        context_version: call.formative_conversation_context_version,
        call_status: call.call_status,
        output_validated: call.output_validated,
        retry_count: call.retry_count,
        latency_ms: call.latency_ms,
        input_tokens: call.input_tokens,
        output_tokens: call.output_tokens,
        total_tokens: call.total_tokens,
        started_at: iso(call.started_at ?? call.created_at),
        completed_at: iso(call.completed_at)
      }))
    )
  );
}

function formativeConversationProfileTransitionRows(
  sessions: AnalysisSession[]
) {
  return sessions.flatMap((session) =>
    session.formative_conversation_sessions.flatMap((conversation) =>
      conversation.profile_transitions.map((transition) => ({
        transition_public_id: transition.transition_public_id,
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        conversation_public_id: conversation.conversation_public_id,
        transition_version: transition.transition_version,
        formative_outcome: transition.learning_outcome,
        prior_understanding_category:
          transition.prior_student_profile.ability_profile,
        prior_learning_profile:
          transition.prior_student_profile.integrated_diagnostic_profile,
        prior_evidence_sufficiency:
          transition.prior_student_profile.evidence_sufficiency,
        prior_confidence_alignment:
          transition.prior_student_profile.confidence_alignment,
        prior_misconception_indicators: JSON.stringify(
          transition.prior_student_profile.misconception_indicators
        ),
        prior_profile_created_at: iso(
          transition.prior_student_profile.created_at
        ),
        updated_understanding_category:
          transition.updated_student_profile.ability_profile,
        updated_learning_profile:
          transition.updated_student_profile.integrated_diagnostic_profile,
        updated_evidence_sufficiency:
          transition.updated_student_profile.evidence_sufficiency,
        updated_confidence_alignment:
          transition.updated_student_profile.confidence_alignment,
        updated_misconception_indicators: JSON.stringify(
          transition.updated_student_profile.misconception_indicators
        ),
        updated_profile_created_at: iso(
          transition.updated_student_profile.created_at
        ),
        canonical_profile_snapshot: JSON.stringify(
          transition.profile_snapshot ?? null
        ),
        learning_observations: JSON.stringify(
          transition.learning_observations ?? []
        ),
        evidence_interpretation:
          transition.evidence_interpretation,
        source_turn_sequence_index:
          transition.source_turn?.sequence_index ?? null,
        supporting_turn_sequence_indexes:
          transition.supporting_turn_references
            .map(
              (reference) =>
                reference.conversation_turn.sequence_index
            )
            .sort((left, right) => left - right)
            .join("|"),
        supporting_turn_actors:
          [...transition.supporting_turn_references]
            .sort(
              (left, right) =>
                left.conversation_turn.sequence_index -
                right.conversation_turn.sequence_index
            )
            .map((reference) =>
              reference.conversation_turn.actor_type === "student"
                ? "student"
                : "tutor"
            )
            .join("|"),
        supporting_turn_evidence_roles:
          [...transition.supporting_turn_references]
            .sort(
              (left, right) =>
                left.conversation_turn.sequence_index -
                right.conversation_turn.sequence_index
            )
            .map((reference) => reference.evidence_role)
            .join("|"),
        evidence_reference_public_ids:
          transition.profile_evidence_references
            .map(
              (reference) =>
                reference.evidence_reference_public_id
            )
            .join("|"),
        assessment_profile_created_at: iso(
          transition.assessment_student_profile?.created_at
        ),
        source_agent_name:
          transition.source_agent_call?.agent_name ?? null,
        source_agent_call_public_id:
          transition.source_agent_call?.agent_call_public_id ?? null,
        transitioned_at: iso(transition.transitioned_at)
      }))
    )
  );
}

function formativeConversationInterventionRows(sessions: AnalysisSession[]) {
  return sessions.flatMap((session) =>
    session.formative_conversation_sessions.flatMap((conversation) =>
      conversation.interventions.map((intervention) => ({
        intervention_public_id: intervention.intervention_public_id,
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        conversation_public_id: conversation.conversation_public_id,
        strategy_type: intervention.strategy_type,
        targeted_evidence_gap: intervention.targeted_evidence_gap,
        status: intervention.status,
        started_at: iso(intervention.started_at),
        completed_at: iso(intervention.completed_at)
      }))
    )
  );
}

function formativeConversationDataDictionaryRows() {
  const tables: Array<{
    dataset: string;
    columns: readonly string[];
    phase: string;
  }> = [
    {
      dataset: "formative_conversation_sessions",
      columns: FORMATIVE_CONVERSATION_SESSION_COLUMNS,
      phase: "formative_conversation"
    },
    {
      dataset: "formative_conversation_turns",
      columns: FORMATIVE_CONVERSATION_TURN_COLUMNS,
      phase: "formative_conversation"
    },
    {
      dataset: "formative_conversation_events",
      columns: FORMATIVE_CONVERSATION_EVENT_COLUMNS,
      phase: "formative_conversation"
    },
    {
      dataset: "formative_conversation_llm_calls",
      columns: FORMATIVE_CONVERSATION_LLM_COLUMNS,
      phase: "formative_conversation"
    },
    {
      dataset: "formative_conversation_profile_transitions",
      columns: FORMATIVE_CONVERSATION_PROFILE_TRANSITION_COLUMNS,
      phase: "profile_transition"
    },
    {
      dataset: "formative_conversation_interventions",
      columns: FORMATIVE_CONVERSATION_INTERVENTION_COLUMNS,
      phase: "formative_conversation"
    }
  ];
  const definition = (dataset: string, variable: string) => {
    if (variable === "message_text") {
      return "Exact visible student or tutor message persisted in chronological order.";
    }
    if (variable === "typing_duration_ms") {
      return "Observed elapsed or active typing duration using the accompanying typing_duration_method.";
    }
    if (variable === "edit_count") {
      return "Count of observed input-change events before the student submitted the message.";
    }
    if (variable === "backspace_count") {
      return "Count of observed Backspace or Delete key events before submission.";
    }
    if (variable === "paste_event_count") {
      return "Count of observed paste events; pasted text is not stored in this field.";
    }
    if (variable === "paste_character_count") {
      return "Total character count observed across paste events; pasted text is not stored.";
    }
    if (variable === "agent_call_public_id" || variable === "source_agent_call_public_id") {
      return "Opaque public join key for the persisted formative conversation AgentCall; provider request identifiers and internal database IDs are excluded.";
    }
    if (variable === "conversation_local_turn_sequence_index") {
      return "One-based persisted turn-telemetry order within this formative conversation.";
    }
    if (variable === "conversation_local_event_sequence_index") {
      return "One-based persisted lifecycle-event order within this formative conversation.";
    }
    if (variable.includes("learning_profile")) {
      return "Validated assessment-specific learning-profile category at the named point in the conversation.";
    }
    if (
      variable === "formative_outcome" ||
      variable === "validated_formative_outcome"
    ) {
      return "Outcome recommended by the formative conversation agent and persisted after provenance validation.";
    }
    if (variable === "latest_profile_transition_public_id") {
      return "Public identifier of the latest persisted formative profile transition; null means no validated profile change exists.";
    }
    if (variable.includes("understanding_category")) {
      return "Assessment-specific understanding category stored in the named append-only profile version.";
    }
    if (variable.includes("confidence_alignment")) {
      return "Confidence-alignment category stored in the named append-only profile version.";
    }
    if (variable.includes("misconception_indicators")) {
      return "JSON representation of the misconception evidence included in the named append-only profile version.";
    }
    if (variable === "canonical_profile_snapshot") {
      return "Complete canonical profile and field-level evidence provenance persisted with the authoritative transition.";
    }
    if (variable === "learning_observations") {
      return "JSON array of learning observations authored by the formative conversation agent from cited conversation evidence.";
    }
    if (variable === "evidence_interpretation") {
      return "Agent-authored interpretation supporting the recorded formative profile transition.";
    }
    if (variable === "supporting_turn_sequence_indexes") {
      return "Pipe-delimited sequence indexes for student and tutor turns linked to the transition.";
    }
    if (variable === "supporting_turn_actors") {
      return "Pipe-delimited actor labels aligned with supporting_turn_sequence_indexes.";
    }
    if (variable === "supporting_turn_evidence_roles") {
      return "Pipe-delimited provenance roles aligned with supporting_turn_sequence_indexes.";
    }
    if (variable === "evidence_reference_public_ids") {
      return "Pipe-delimited public references to persisted conversation evidence observations linked to the transition.";
    }
    if (variable === "assessment_profile_created_at") {
      return "Creation timestamp of the initial assessment profile supplied as assessment-phase provenance.";
    }
    if (variable.includes("evidence_sufficiency")) {
      return "Validated evidence-sufficiency category associated with the named profile.";
    }
    if (variable === "wall_clock_duration_ms") {
      return "Elapsed milliseconds from conversation start to completion, end, or latest recorded activity.";
    }
    if (variable.endsWith("_count")) {
      return `Count of ${variable.replace(/_count$/, "").replaceAll("_", " ")} records linked to the conversation.`;
    }
    if (variable.endsWith("_at")) {
      return `Timestamp for ${variable.replace(/_at$/, "").replaceAll("_", " ")} in the ${dataset.replaceAll("_", " ")} record.`;
    }
    if (variable.includes("token")) {
      return "Provider-reported token usage for the formative conversation agent call.";
    }
    if (variable === "latency_ms") {
      return "Observed end-to-end provider call latency in milliseconds.";
    }
    if (variable === "event_type") {
      return "Allow-listed observable formative conversation lifecycle or navigation event.";
    }
    if (variable === "event_source") {
      return "Component that directly recorded the observable event.";
    }
    return `${variable.replaceAll("_", " ")} for one ${dataset.replaceAll("_", " ")} record.`;
  };
  const rows = tables.flatMap((table) =>
    table.columns.map((variable) => ({
      dataset: table.dataset,
      variable,
      definition: definition(table.dataset, variable),
      source_nature:
        table.phase === "profile_transition" ||
        /learning_profile|evidence_sufficiency/.test(variable)
          ? "validated_derived_interpretation"
          : /wall_clock_duration|_count$/.test(variable)
            ? "derived_from_persisted_observations"
            : "directly_recorded_observable_or_operational",
      analysis_phase: table.phase,
      interpretation_caution:
        table.phase === "profile_transition"
          ? "Profile transitions are validated interpretations with explicit evidence provenance, not raw observations or stable traits."
          : "Observable conversation and process fields must not be treated as help seeking, learning strategy, conversational depth, motivation, or misconception resolution without a separate documented derivation."
    }))
  );
  return [
    ...rows,
    ...[
      "help_seeking",
      "learning_strategy",
      "conversational_depth",
      "misconception_resolution"
    ].map((variable) => ({
      dataset: "derived_variables_not_stored",
      variable,
      definition: `${variable.replaceAll("_", " ")} may be derived later from documented transcript, telemetry, and profile-transition evidence.`,
      source_nature: "derive_later_not_runtime",
      analysis_phase: "post_export_analysis",
      interpretation_caution:
        "This construct is not recorded as raw runtime data and requires a separate validated derivation method."
    }))
  ];
}

function assertAnalysisReadySafety(files: Array<{ path: string; data: string }>, includeRestricted: boolean) {
  for (const file of files) {
    const patterns =
      file.path === "research_data_dictionary.csv" || file.path === "process_event_codebook.csv"
        ? SECRET_PATTERNS.filter((pattern) => !/password_hash|access_code_hash|database_url|session_secret/i.test(pattern.source))
        : SECRET_PATTERNS;
    for (const pattern of patterns) {
      if (pattern.test(file.data)) {
        throw new Error(`Analysis-ready export safety scan blocked secret-like content in ${file.path}.`);
      }
    }
  }
  if (!includeRestricted) {
    for (const file of files) {
      if (file.path === "research_data_dictionary.csv" || file.path === "process_event_codebook.csv") continue;
      const header = file.data.split(/\r?\n/, 1)[0] ?? "";
      for (const column of restrictedDefaultColumns) {
        if (header.split(",").includes(column)) {
          throw new Error(`Default analysis-ready export included restricted column ${column}.`);
        }
      }
    }
  }
}

function sessionDiagnosticManifest(source: ExportSourceIdentity, sessions: AnalysisSession[], supplemental: SupplementalRecords) {
  return JSON.stringify(
    {
      bundle_type: "assessment_workflow_diagnostic_bundle",
      export_schema_version: source.export_schema_version,
      export_run_public_id: source.export_run_public_id,
      export_scope: source.export_scope,
      selected_session_public_id: source.selected_session_public_id ?? null,
      generated_at: source.export_generated_at,
      preservation_note:
        "Export first and preserve existing profile, formative decision, follow-up, activity, process-event, conversation-turn, and agent-call records before rerunning assessment intelligence.",
      included_files: [
        "sessions.csv",
        "item_responses.csv",
        "process_events.csv",
        "conversation_turns.csv",
        "agent_activity_records.csv",
        "formative_conversation_sessions.csv",
        "formative_conversation_turns.csv",
        "formative_conversation_events.csv",
        "formative_conversation_llm_calls.csv",
        "formative_conversation_profile_transitions.csv",
        "formative_conversation_interventions.csv",
        "formative_conversation_data_dictionary.csv",
        "assessment_content.csv",
        "assessment_summary.csv",
        "research_data_dictionary.csv",
        "process_event_codebook.csv"
      ],
      sessions: sessions.map((session) => {
        const conceptUnitSessions = session.concept_unit_sessions;
        const usesFormativeConversation =
          session.formative_conversation_sessions.length > 0;
        const historicalActivityAttemptCount =
          supplemental.activityAttempts.filter(
            (attempt) =>
              attempt.session_public_id === session.session_public_id
          ).length;
        return {
          session_public_id: session.session_public_id,
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          status: session.status,
          current_phase: session.current_phase,
          resume_phase: session.resume_phase,
          attempt_number: session.attempt_number,
          started_at: iso(session.started_at),
          completed_at: iso(session.completed_at),
          item_response_count: conceptUnitSessions.reduce((total, entry) => total + entry.item_responses.length, 0),
          response_package_count: conceptUnitSessions.reduce((total, entry) => total + entry.response_packages.length, 0),
          student_profile_count: conceptUnitSessions.reduce((total, entry) => total + entry.student_profiles.length, 0),
          formative_decision_count: conceptUnitSessions.reduce((total, entry) => total + entry.formative_decisions.length, 0),
          followup_round_count: conceptUnitSessions.reduce((total, entry) => total + entry.followup_rounds.length, 0),
          formative_activity_attempt_count: usesFormativeConversation
            ? 0
            : historicalActivityAttemptCount,
          legacy_non_authoritative_activity_record_count:
            usesFormativeConversation
              ? historicalActivityAttemptCount +
                conceptUnitSessions.reduce(
                  (total, entry) =>
                    total + entry.followup_rounds.length,
                  0
                )
              : conceptUnitSessions.reduce(
                  (total, entry) =>
                    total + entry.followup_rounds.length,
                  0
                ),
          post_activity_evidence_count: supplemental.evidenceRecords.filter(
            (record) => record.session_public_id === session.session_public_id
          ).length,
          diagnostic_snapshot_count: supplemental.snapshots.filter(
            (snapshot) => snapshot.session_public_id === session.session_public_id
          ).length,
          conversation_turn_count: session.conversation_turns.length,
          process_event_count: session.process_events.length,
          agent_calls: session.agent_calls.map((call) => ({
            agent_name: call.agent_name,
            agent_version: call.agent_version,
            provider: call.provider,
            model_name: call.model_name,
            call_status: call.call_status,
            prompt_version: call.prompt_version,
            schema_version: call.schema_version,
            output_validated: call.output_validated,
            validation_error_present: Boolean(call.validation_error),
            retry_count: call.retry_count,
            started_at: iso(call.started_at),
            completed_at: iso(call.completed_at)
          })),
          formative_conversations:
            session.formative_conversation_sessions.map((conversation) => ({
              conversation_public_id: conversation.conversation_public_id,
              status: conversation.status,
              turn_count: conversation.conversation_turns.length,
              event_count: conversation.lifecycle_events.length,
              agent_call_count: conversation.agent_calls.length,
              profile_transition_count:
                conversation.profile_transitions.length,
              intervention_count: conversation.interventions.length
            })),
          workflow_jobs: session.workflow_jobs.map((job) => ({
            job_public_id: job.job_public_id,
            job_type: job.job_type,
            status: job.status,
            attempt_count: job.attempt_count,
            max_attempts: job.max_attempts,
            last_error_category: job.last_error_category,
            last_error_message_present: Boolean(job.last_error_message),
            created_at: iso(job.created_at),
            completed_at: iso(job.completed_at)
          }))
        };
      }),
      protected_values_absent: [
        "password",
        "email",
        "login_username",
        "api_key",
        "database_connection_secret",
        "raw_provider_payload",
        "hidden_system_prompt"
      ]
    },
    null,
    2
  );
}

export async function buildAnalysisReadyResearchDataBundle(input: {
  teacher_user_db_id: string;
  scope: "all_authorized" | "selected_assessment" | "selected_student" | "selected_session";
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
  include_incomplete_sessions?: boolean;
  include_restricted_fields?: boolean;
}) {
  try {
    assertResearchPseudonymizationReadyForExport();
  } catch (error) {
    if (error instanceof ResearchPseudonymizationConfigError) {
      throw new ContentServiceError(error.code, error.message, 503, {
        retryable: true,
        operator_action: "Run research-export:preflight and configure the server-side research pseudonymization key."
      });
    }
    throw error;
  }

  const sessions = await loadSessions(input);
  if (sessions.length === 0) {
    throw new ContentServiceError(
      "no_session_data",
      "No student sessions are available for this export scope.",
      409
    );
  }

  const source = sourceFor(input);
  const supplemental = await loadSupplementalRecords(sessions.map((session) => session.session_public_id));
  const includeRestricted = input.include_restricted_fields === true;
  const files = [
    {
      path: "sessions.csv",
      data: csv(SESSIONS_COLUMNS, sessionRows(source, sessions, supplemental))
    },
    {
      path: "item_responses.csv",
      data: csv(columnsFor(ITEM_RESPONSES_COLUMNS, includeRestricted), itemResponseRows(source, sessions, includeRestricted))
    },
    {
      path: "process_events.csv",
      data: csv(PROCESS_EVENTS_COLUMNS, processEventRows(sessions))
    },
    {
      path: "conversation_turns.csv",
      data: csv(CONVERSATION_TURNS_COLUMNS, conversationRows(sessions))
    },
    {
      path: "agent_activity_records.csv",
      data: csv(AGENT_ACTIVITY_RECORDS_COLUMNS, agentAndActivityRows(sessions, supplemental))
    },
    {
      path: "formative_conversation_sessions.csv",
      data: csv(
        FORMATIVE_CONVERSATION_SESSION_COLUMNS,
        formativeConversationSessionRows(sessions)
      )
    },
    {
      path: "formative_conversation_turns.csv",
      data: csv(
        FORMATIVE_CONVERSATION_TURN_COLUMNS,
        formativeConversationTurnRows(sessions)
      )
    },
    {
      path: "formative_conversation_events.csv",
      data: csv(
        FORMATIVE_CONVERSATION_EVENT_COLUMNS,
        formativeConversationEventRows(sessions)
      )
    },
    {
      path: "formative_conversation_llm_calls.csv",
      data: csv(
        FORMATIVE_CONVERSATION_LLM_COLUMNS,
        formativeConversationLlmRows(sessions)
      )
    },
    {
      path: "formative_conversation_profile_transitions.csv",
      data: csv(
        FORMATIVE_CONVERSATION_PROFILE_TRANSITION_COLUMNS,
        formativeConversationProfileTransitionRows(sessions)
      )
    },
    {
      path: "formative_conversation_interventions.csv",
      data: csv(
        FORMATIVE_CONVERSATION_INTERVENTION_COLUMNS,
        formativeConversationInterventionRows(sessions)
      )
    },
    {
      path: "formative_conversation_data_dictionary.csv",
      data: csv(
        FORMATIVE_CONVERSATION_DICTIONARY_COLUMNS,
        formativeConversationDataDictionaryRows()
      )
    },
    {
      path: "assessment_content.csv",
      data: csv(columnsFor(ASSESSMENT_CONTENT_COLUMNS, includeRestricted), assessmentContentRows(sessions, includeRestricted))
    },
    {
      path: "assessment_summary.csv",
      data: csv(ASSESSMENT_SUMMARY_COLUMNS, assessmentSummaryRows(source, sessions, supplemental))
    },
    {
      path: "research_data_dictionary.csv",
      data: dataDictionaryCsv()
    },
    {
      path: "process_event_codebook.csv",
      data: processEventCodebookCsv()
    }
  ];
  if (input.scope === "selected_session") {
    files.push({
      path: "session_diagnostic_manifest.json",
      data: sessionDiagnosticManifest(source, sessions, supplemental)
    });
  }
  assertAnalysisReadySafety(files, includeRestricted);

  const suffix =
    input.scope === "selected_assessment" && input.assessment_public_id
      ? `assessment_${input.assessment_public_id}`
      : input.scope === "selected_student" && input.student_user_id
        ? `student_${input.student_user_id}`
        : input.scope === "selected_session" && input.session_public_id
          ? `session_${input.session_public_id}`
          : "all_authorized";

  return {
    filename: `${suffix}_research_dataset.zip`,
    content_type: "application/zip",
    buffer: createStoreOnlyZip(files),
    files,
    source,
    row_counts: Object.fromEntries(
      files.map((file) => [
        file.path,
        serializedFileRecordCount(file)
      ])
    ),
    restricted_fields_included: includeRestricted,
    no_live_provider_call_made: true
  };
}
