import { createHash } from "node:crypto";
import { isConfidenceRevisionEvent } from "../student-assessment/response-revision-events";
import { conversationVisibility, CONVERSATION_VISIBILITY_VERSION } from "../student-assessment/conversation-visibility";
import { profileRecordProvenance, profileRecordIdentity, profileEvidenceCounts, profileSourceCallSelect, profileReassessmentStatus, profileItemEvidence, PROFILE_PROVENANCE_COLUMNS, PROFILE_FIELD_DEFINITIONS, PROFILE_PROJECTION_VERSION } from "@/lib/services/student-assessment/profile-record";
import { CONVERSATION_UPDATE_SUMMARY_COLUMNS, conversationUpdateSummary, initialLearningProfile, learningProfileInclude, learningProfileSummary, UNDERSTANDING_SUMMARY_COLUMNS } from "@/lib/services/student-assessment/learning-profile-summary";
import { observeAttempts } from "@/lib/services/teacher-dashboard/attempt-comparison";
import { initialProfileTransferRule } from "@/lib/services/student-assessment/initial-profile-transfer-labels";
import { attemptComparisonExportFiles } from "./attempt-comparison-export";
import { responseStageExportFiles } from "./response-stage-export";
import { AI_CALL_AUDIT_COLUMNS, AI_CALL_AUDIT_DEFINITIONS, AI_CALL_AUDIT_DICTIONARY_FILE, AI_CALL_AUDIT_FILE, instructorReportAuditRows, sessionAiCallAuditRows } from "./ai-call-audit-export";
import { researchCsv, RESEARCH_CSV_CONTRACT_VERSION } from "./csv-contract";
import { researchStudyTemplateFiles, STUDY_TEMPLATE_VERSION } from "./study-templates";
import { MEASUREMENT_AVAILABILITY_VERSION } from "./measurement-availability";
import { conversationActivityDates, conversationParticipation, derivePauseEpisodes, PAUSE_EPISODE_DEFINITIONS } from "../teacher-review/participation-observations";
import { presentedItemPositions } from "../teacher-review/presented-item-positions";
import { acceptedTemptingEvidence, RESPONSE_EVIDENCE_VERSION } from "../student-assessment/response-evidence";
import { ResearchExportSpool, withResearchExportSlot } from "./export-spool";
import { exportStorageDirectory, pathForStorageKey } from "../master-export/storage";
import { parse } from "csv-parse/sync";
import { separateConversationTiming } from "./conversation-timing";
import { conversationEndReason, conversationEngagement, conversationMessageType, openingOutcome } from "./conversation-outcome";
import { FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID } from "@/lib/services/student-assessment/formative-conversation/opening-contract";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveCanonicalAttemptLifecycle } from "@/lib/services/student-assessment/attempt-lifecycle";
import { parseCanonicalMisconceptionClaimCatalog } from "@/lib/domain/misconception-claim-identity";
import { ContentServiceError } from "@/lib/services/content/errors";
import { asArray, asRecord } from "@/lib/services/teacher-review/serializers";
import {
  TIMING_CONTRACT_VERSION,
  TIMING_SOURCE_VERSION,
  SESSION_TIMING_CONTRACT_VERSION,
  deriveItemTiming,
  deriveSessionTiming,
  deriveVisibilityIntervals,
  eventTimestamp,
  firstOptionSelectionTiming,
  summarizePageVisibility,
  timingLimitationsText
} from "@/lib/services/student-assessment/timing-contract";
import { answerReviewExplanation, itemProcessColumns, itemReferenceColumns } from "./item-research-columns";
import {
  canonicalPersistedFormativeConversationProfileTransitions,
  latestPersistedFormativeConversationProfileTransition,
  persistedFormativeConversationOutcome
} from "@/lib/services/student-assessment/formative-conversation/profile-projection";
import { formativeConversationTurnLimit } from "@/lib/services/student-assessment/formative-conversation/lifecycle-contract-v18r2";
import { parseFormativeConversationProfileSnapshot } from "@/lib/services/student-assessment/formative-conversation/profile-update";
import { createStoreOnlyZip } from "@/lib/services/teacher-research-export/zip";
import {
  buildExportSourceIdentity,
  privacySafeStudentArtifactSegment,
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
  researchInstructorId,
  researchPseudonymizationMetadata,
  researchStudentId
} from "./pseudonymization";
import {
  currentItemDecisions,
  interpretationV8SessionFiles,
  itemAdministrationV4Fields,
  itemReviewDecisionFile,
  loadInterpretationV8CallRecords,
  loadItemReviewDecisionRecords,
  withInterpretationV8ProfileColumns,
  type CurrentItemDecisions,
  type ItemReviewDecisionRecord,
  type V8ExportSession
} from "./interpretation-v8-export";
import {
  INTERPRETATION_V8_EXPORT_VERSION,
  INTERPRETATION_V8_NOTES_FILE,
  INTERPRETATION_V8_PROFILE_COLUMNS,
  interpretationV8ColumnDoc,
  interpretationV8LegacyNote
} from "./interpretation-v8-dictionary";
import {
  MINI_TEST_CATALOG_COLUMNS,
  STUDENT_PARTICIPATION_SUMMARY_COLUMNS,
  STUDENT_ROSTER_COLUMNS,
  STUDY_PARTICIPATION_EXPORT_VERSION,
  STUDY_PARTICIPATION_README_LINES,
  STUDY_PARTICIPATION_RESTRICTED_COLUMNS,
  SUMMATIVE_OUTCOMES_COLUMNS
} from "./study-participation-dictionary";
import {
  loadStudyScope,
  loadSummativeOutcomeRecords,
  miniTestCatalog,
  sharedStudyCodes,
  studentParticipationSummaryRows,
  studentRosterRows,
  summativeOutcomeRows,
  type ParticipationAttempt
} from "./study-participation-export";
import { MAX_INCLUDED_STUDY_CODES, parseStudyCodeList } from "./study-code";

type CsvPrimitive = string | number | boolean | null;
type CsvRow = Record<string, CsvPrimitive>;

/** Files produced only in restricted exports; the safety scan refuses them in a default export. */
const RESTRICTED_ONLY_FILES = new Set([
  AI_CALL_AUDIT_FILE,
  AI_CALL_AUDIT_DICTIONARY_FILE,
  "interpretation_process_audit.csv",
  "summative_outcomes.csv"
]);

const INITIAL_PACKAGE_TYPE = "initial_concept_unit_response_package";

const restrictedDefaultColumns = new Set([
  "correct_option",
  "correctness",
  "correctness_support_level",
  "unsupported_correct_response",
  "estimated_guessing_risk",
  "answer_selection_evidence_weight",
  "teacher_llm_media_description",
  "target_reasoning_note",
  "essential_elements",
  "option_rationales_json",
  // The answer review text names or paraphrases the keyed option.
  "answer_review_explanation",
  // Interpretation v8 item ratings: correctness, withheld from default exports like item_responses.correctness.
  "answer_correct",
  // First-attempt scores in student_participation_summary.csv.
  ...STUDY_PARTICIPATION_RESTRICTED_COLUMNS
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
      revision_family_public_id: true,
      concept_units: { where: { items: { some: { included_in_published_set: true } } }, select: { id: true } },
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
              administration_rules: true,
              included_in_published_set: true,
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
          id: true,
          // output_payload: the profiling model's original output, compared with the saved
          // profile for initial_profile_transfer_rule (D13).
          based_on_agent_call: { select: { ...profileSourceCallSelect, output_payload: true } },
          ability_pattern_flags: true,
          misconception_indicators: true,
          process_interpretation_cautions: true,
          confidence_alignment: true,
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
      latest_student_profile: { include: learningProfileInclude },
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
        include: { based_on_agent_call: { select: profileSourceCallSelect } }
      },
      current_student_profile: {
        include: { based_on_agent_call: { select: profileSourceCallSelect } }
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
                  agent_call_public_id: true,
                  latency_ms: true
                }
              }
            }
          },
          formative_conversation_input_telemetry: true
        }
      },
      message_receipts: {
        // Student-message receipts, plus the opening receipt (opening_status, opening_failure_code).
        where: {
          OR: [
            { student_turn_db_id: { not: null } },
            { client_message_id: FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID }
          ]
        },
        orderBy: { created_at: "asc" },
        select: {
          receipt_public_id: true,
          client_message_id: true,
          status: true,
          failure_code: true,
          assistant_turn_db_id: true,
          response_payload: true,
          updated_at: true,
          student_turn_db_id: true,
          assistant_response_status: true,
          assistant_response_retry_count: true,
          assistant_response_last_failure_category: true,
          assistant_response_last_failed_at: true,
          agent_calls: {
            orderBy: { created_at: "desc" },
            take: 1,
            select: {
              agent_call_public_id: true
            }
          }
        }
      },
      lifecycle_events: {
        orderBy: { sequence_index: "asc" },
        include: {
          agent_call: {
            select: {
              agent_call_public_id: true
            }
          }
        }
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
          created_at: true,
          formative_conversation_message_receipt: {
            select: {
              receipt_public_id: true
            }
          }
        }
      },
      profile_transitions: {
        orderBy: { transitioned_at: "asc" },
        include: {
          prior_student_profile: { include: { based_on_agent_call: { select: profileSourceCallSelect } } },
          updated_student_profile: { include: { based_on_agent_call: { select: profileSourceCallSelect } } },
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
      },
      review_signals: {
        orderBy: { created_at: "asc" },
        select: {
          signal_public_id: true,
          signal_type: true,
          reason_code: true,
          evidence_summary: true,
          created_at: true
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

/**
 * R7: attempt_number counts attempts within one assessment version, but the three-attempt
 * limit counts the whole revision family (a corrected version continues the original's
 * chances). family_attempt_number orders all of the student's attempts in the family, on
 * any version, by creation time, so "attempt 1" of a corrected version can be told apart
 * from a first attempt overall. Waived (restored) chances are still counted here; see
 * chance_waived_at in attempt_records.csv.
 */
const familyAttemptIdentity = new WeakMap<object, { assessment_family_public_id: string; family_attempt_number: number }>();

async function resolveFamilyAttemptIdentity(tx: Prisma.TransactionClient, session: AnalysisSession) {
  const family = session.assessment.revision_family_public_id ?? session.assessment.assessment_public_id;
  const earlier = await tx.assessmentSession.count({
    where: {
      user: { user_id: session.user.user_id },
      assessment: { OR: [{ assessment_public_id: family }, { revision_family_public_id: family }] },
      OR: [{ created_at: { lt: session.created_at } }, { created_at: session.created_at, id: { lt: session.id } }]
    }
  });
  const identity = { assessment_family_public_id: family, family_attempt_number: earlier + 1 };
  familyAttemptIdentity.set(session, identity);
  return identity;
}

type SupplementalRecords = Awaited<ReturnType<typeof loadSupplementalRecords>>;

const FORMATIVE_CONVERSATION_SESSION_COLUMNS = [
  "participation_observation_version",
  "tutor_reply_count",
  "displayed_tutor_reply_count",
  "first_tutor_display_received_at",
  "first_student_message_at",
  "student_participated",
  "last_turn_at",
  "engaged_duration_ms",
  ...PROFILE_PROVENANCE_COLUMNS,
  "profile_reassessment_status",
  "initial_profile_record_id",
  "current_profile_record_id",
  "session_public_id",
  "research_student_id",
  "assessment_public_id",
  "concept_unit_public_id",
  "conversation_public_id",
  "conversation_status",
  "opening_status",
  "opening_failure_code",
  "started_at",
  "last_activity_at",
  "paused_at",
  "completed_at",
  "ended_at",
  "wall_clock_duration_ms",
  "turn_count",
  "student_formative_turn_count",
  "current_student_turn_index",
  "max_student_turns",
  "final_allowed_turn",
  "another_student_turn_available",
  "lifecycle_termination_source",
  "lifecycle_termination_reason",
  "end_reason",
  "semantic_teacher_assistance_recommended",
  "platform_lifecycle_handoff",
  "lifecycle_event_count",
  "agent_call_count",
  "intervention_count",
  "profile_transition_count",
  "latest_profile_transition_public_id",
  "validated_formative_outcome",
  "initial_learning_profile",
  "initial_profile_evidence_sufficiency",
  "current_learning_profile",
  "current_profile_evidence_sufficiency",
  ...INTERPRETATION_V8_PROFILE_COLUMNS
] as const;

const FORMATIVE_CONVERSATION_TURN_COLUMNS = [
  "session_public_id",
  "research_student_id",
  "conversation_public_id",
  "response_receipt_public_id",
  "agent_call_public_id",
  "turn_sequence_index",
  "conversation_local_turn_sequence_index",
  "actor_type",
  "actor_name",
  "message_type",
  "message_text",
  "generation_source",
  "validator_status",
  "fallback_used",
  "assistant_response_status",
  "assistant_response_retry_count",
  "assistant_response_failure_category",
  "assistant_response_failed_at",
  "created_at",
  "turn_started_at",
  "turn_submitted_at",
  "response_time_ms",
  "student_input_elapsed_ms",
  "model_call_latency_ms",
  "student_timing_method",
  "student_timing_status",
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
  "agent_call_public_id",
  "agent_name",
  "failure_category",
  "retry_count",
  "observed_interval_duration_ms",
  "occurred_at",
  "created_at"
] as const;

const FORMATIVE_CONVERSATION_LLM_COLUMNS = [
  "session_public_id",
  "research_student_id",
  "conversation_public_id",
  "response_receipt_public_id",
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
  "prior_profile_record_id",
  "updated_profile_record_id",
  "session_public_id",
  "research_student_id",
  "conversation_public_id",
  "transition_version",
  "formative_outcome",
  "prior_understanding_category",
  "prior_learning_profile",
  "prior_evidence_sufficiency",
  "prior_confidence_alignment",
  "prior_confidence_alignment_scope",
  "prior_misconception_indicators",
  "prior_misconception_claim_catalog",
  "prior_profile_created_at",
  "updated_understanding_category",
  "updated_learning_profile",
  "updated_evidence_sufficiency",
  "updated_confidence_alignment",
  "updated_confidence_alignment_scope",
  "updated_misconception_indicators",
  "updated_misconception_claim_catalog",
  "misconception_claim_dispositions",
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
  "interpretation_caution",
  "calculation",
  "unit",
  "missing_values"
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
  return researchCsv(
    rows.map((row) => Object.fromEntries(columns.map((column) => [column, csvSafe(row[column])]))),
    columns
  );
}

export function countSerializedCsvDataRows(data: string) {
  const records = parse(data, {
    columns: false,
    skip_empty_lines: true
  }) as unknown[][];
  return Math.max(0, records.length - 1);
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

type SessionScope = {
  teacher_user_db_id: string;
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
  include_incomplete_sessions?: boolean;
  /** Participant filter: only these students (login user_ids, resolved from study codes). */
  student_user_ids?: string[];
};

/**
 * include_incomplete_sessions false drops only attempts that were never submitted: a submitted
 * attempt (sealed initial response package, sessions.initial_package_sealed) is always kept,
 * whether or not the student chose Finish.
 */
function sessionWhere(input: SessionScope): Prisma.AssessmentSessionWhereInput {
  const conditions: Prisma.AssessmentSessionWhereInput[] = [];
  if (input.include_incomplete_sessions === false) conditions.push({ OR: [
    { status: "completed" },
    { concept_unit_sessions: { some: { response_packages: { some: { package_type: INITIAL_PACKAGE_TYPE } } } } }
  ] });
  if (input.student_user_ids) conditions.push({ user: { user_id: { in: input.student_user_ids } } });
  return {
    session_public_id: input.session_public_id,
    assessment: { assessment_public_id: input.assessment_public_id },
    user: {
      role: "student",
      user_id: input.student_user_id
    },
    OR: authorizedSessionOr(input.teacher_user_db_id),
    ...(conditions.length ? { AND: conditions } : {})
  };
}

async function loadSessions(input: SessionScope, db: Prisma.TransactionClient = prisma) {
  return db.assessmentSession.findMany({
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

async function loadSupplementalRecords(sessionPublicIds: string[], db: Prisma.TransactionClient = prisma) {
  const [activityAttempts, evidenceRecords, snapshots] = await Promise.all([
    db.activityRuntimeAttempt.findMany({
      where: { session_public_id: { in: sessionPublicIds } },
      orderBy: [{ created_at: "asc" }]
    }),
    db.activityMisconceptionEvidenceRecord.findMany({
      where: { session_public_id: { in: sessionPublicIds } },
      orderBy: [{ created_at: "asc" }]
    }),
    db.postActivityDiagnosticSnapshot.findMany({
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
    selected_student_id: input.student_user_id
      ? researchStudentId(input.student_user_id)
      : undefined,
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

/**
 * R4 (docs/RESEARCH_DATA_REVIEW_2026-10-17.md): what evidence an attempt actually
 * produced, independent of session_status. Early pilot attempts often never reached
 * "completed" even when the student had done everything (later-fixed defects and the
 * optional Finish step), so analyses should select attempts by evidence stage.
 */
/**
 * R1/H2: which data-collection rules an attempt ran under. An attempt started before
 * the 2026-10-17 rules has no version on its session_started event; if it was
 * continued with the newer application (which records a tab claim on every page
 * load), its later items ran under the new rules, so it is flagged as mixed.
 */
function dataCollectionRulesFields(events: AnalysisSession["process_events"]) {
  const version = payloadString(firstEvent(events, ["session_started"])?.payload, ["data_collection_rules_version"]);
  const claimCount = events.filter((event) => event.event_type === "attempt_tab_claimed").length;
  // An attempt started under the 2026-10-17 rules and continued after the 2026-10-18
  // update shows window-focus observations, which only the newer application records.
  const focusRecorded = events.some((event) => event.event_type === "response_stage_observation" &&
    typeof asRecord(event.payload).document_has_focus === "boolean");
  return {
    data_collection_rules_version: version ?? "pre_2026_10_17_unversioned",
    data_collection_rules_changed_during_attempt: (!version && claimCount > 0) ||
      (version === "data-collection-rules-2026-10-17" && focusRecorded),
    // Blank (not 0) when tab claims were not yet recorded for this attempt.
    attempt_tab_claim_count: version || claimCount > 0 ? claimCount : null
  };
}

function evidenceStageFields(session: AnalysisSession) {
  const packageSealed = session.concept_unit_sessions.some((unit) =>
    unit.response_packages.some((pkg) => pkg.package_type === "initial_concept_unit_response_package"));
  const feedbackShown = session.process_events.some((event) =>
    ["formative_feedback_shown", "package_results_shown", "item_correctness_status_shown"].includes(event.event_type));
  const conversationStarted = session.formative_conversation_sessions.length > 0;
  const studentMessages = session.formative_conversation_sessions.reduce((total, conversation) =>
    total + conversation.conversation_turns.filter((turn) => turn.actor_type === "student").length, 0);
  const finishChosen = session.status === "completed";
  const stage = !packageSealed ? "responses_incomplete"
    : finishChosen ? "finished"
      : studentMessages > 0 ? "conversation_participated"
        : feedbackShown ? "feedback_shown"
          : "package_sealed";
  return {
    initial_package_sealed: packageSealed,
    feedback_shown: feedbackShown,
    conversation_started: conversationStarted,
    conversation_student_message_count: studentMessages,
    finish_chosen: finishChosen,
    evidence_stage: stage
  };
}

function snapshotHasOptionE(response: AnalysisSession["concept_unit_sessions"][number]["item_responses"][number]) {
  const options = itemSnapshotRecord(response).options;
  return Array.isArray(options) && options.some((option) => asRecord(option).label === "E");
}

function packageEvidenceByItem(session: AnalysisSession) {
  const packages = session.concept_unit_sessions
    .flatMap((conceptUnitSession) => conceptUnitSession.response_packages)
    .filter((responsePackage) => responsePackage.package_type === "initial_concept_unit_response_package")
    .sort((left, right) => right.created_at.getTime() - left.created_at.getTime());
  const evidence = new Map<string, Record<string, unknown>>();
  for (const entry of packages.flatMap((row) => asArray(asRecord(row.payload).item_responses).map(asRecord))) {
    const id = String(entry.item_public_id ?? "");
    if (id && !evidence.has(id)) evidence.set(id, entry);
  }
  return evidence;
}

function firstSealedPackageItem(conceptUnitSession: AnalysisSession["concept_unit_sessions"][number], itemPublicId: string) {
  for (const responsePackage of conceptUnitSession.response_packages) {
    if (responsePackage.package_type !== "initial_concept_unit_response_package") continue;
    const payload = asRecord(responsePackage.payload);
    const item = asArray(payload.item_responses).map(asRecord).find((entry) => entry.item_public_id === itemPublicId);
    if (item) return { item, topic: asRecord(payload.concept_unit) };
  }
  return null;
}

function isInitialResponse(response: AnalysisSession["concept_unit_sessions"][number]["item_responses"][number]) {
  const snapshot = itemSnapshotRecord(response);
  const role = snapshot.item_role ?? asRecord(snapshot.administration_rules ?? response.item.administration_rules).item_role;
  return role !== "transfer" || response.item.included_in_published_set;
}

function initialItemCount(session: AnalysisSession) {
  return session.concept_unit_sessions.reduce((total, concept) => {
    const counts = session.process_events.filter((event) => event.concept_unit_session_db_id === concept.id)
      .map((event) => payloadNumber(event.payload, ["initial_item_count"])).filter((value): value is number => value !== null && value >= 0);
    return total + Math.max(0, ...counts, concept.item_responses.filter(isInitialResponse).length);
  }, 0);
}

function canonicalActionCount(events: AnalysisSession["process_events"], types: string[]) {
  // Backend aliases describe the same action; use the canonical stream, with
  // older naming variants only as a fallback when that stream is absent.
  for (const type of types) {
    const count = countEvents(events, [type]);
    if (count) return count;
  }
  return 0;
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

// Profile produced from the submitted mini-test; conversation updates are exported separately.
function latestProfile(session: AnalysisSession) {
  return initialLearningProfile(session);
}

function evidenceProfileV2(profile: { item_level_evidence: unknown } | null) {
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
  return learningProfileSummary(profile).understanding_label;
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
    assessment_family_public_id: familyAttemptIdentity.get(session)?.assessment_family_public_id
      ?? session.assessment.revision_family_public_id ?? session.assessment.assessment_public_id,
    family_attempt_number: familyAttemptIdentity.get(session)?.family_attempt_number ?? null,
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

function sessionRows(source: ExportSourceIdentity, sessions: AnalysisSession[], supplemental: SupplementalRecords,
  decisions: CurrentItemDecisions = new Map()) {
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
    const initialResponses = responses.filter(isInitialResponse);
    const longPauseEvents = session.process_events.filter((event) => event.event_type === "long_pause");
    const sessionTiming = deriveSessionTiming({
      session_started_at: session.started_at ?? session.created_at,
      session_completed_at: session.completed_at,
      last_activity_at: session.last_activity_at,
      updated_at: session.updated_at,
      events: session.process_events,
      additional_activity_at: conversationActivityDates(session.formative_conversation_sessions)
    });
    const elapsed = sessionTiming.session_wall_clock_elapsed_ms;
    const activeTime = sessionTiming.session_active_interaction_time_ms;
    const totalIdle = sessionTiming.session_idle_time_ms;
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
    const feedbackUnavailableEvent = lastEvent(sessionEvents, ["initial_feedback_skipped", "initial_feedback_terminated"]);
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
      feedbackUnavailableEvent ? "incomplete_technical_failure" : activeActivityAttempt?.status === "move_on_recommended"
        ? "skipped"
        : activeActivityAttempt?.completed_at
          ? "completed"
          : activeActivityAttempt?.status ?? null;
    const packageCompletionEvent = lastEvent(sessionEvents, ["package_completion_operation_completed"]);
    const recoveryEvent = lastEvent(sessionEvents, ["package_completion_reconciled"]);
    const displayAckEvent = lastEvent(sessionEvents, [
      "package_results_shown",
      "formative_feedback_shown",
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
      ["completed", "ended_by_student", "ended_by_teacher"].includes(attemptLifecycleStatus)
        ? "SESSION_COMPLETE"
        : usesFormativeConversation
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
    // Interpretation v8 profiles: legacy label columns blank, v8 summary columns added.
    return withInterpretationV8ProfileColumns("sessions", {
      ...sessionBase(source, session),
      session_status: session.status,
      current_phase: session.current_phase,
      started_at: iso(session.started_at),
      last_activity_at: iso(session.last_activity_at),
      completed_at: iso(session.completed_at),
      resumed_at: iso(firstEvent(session.process_events, ["session_resumed"])?.occurred_at ?? null),
      exited_at: iso(firstEvent(session.process_events, ["session_exited"])?.occurred_at ?? null),
      // R1: the build and data-collection rules the attempt ran under (blank for
      // attempts started before 2026-10-17 instrumentation).
      collecting_application_git_commit: payloadString(firstEvent(session.process_events, ["session_started"])?.payload, ["application_git_commit"]),
      ...dataCollectionRulesFields(session.process_events),
      ...evidenceStageFields(session),
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
      activity_skip_reason: feedbackUnavailableEvent?.event_type === "initial_feedback_skipped" ? "initial_feedback_unavailable" : activitySkippedEvent
        ? payloadString(activitySkippedEvent.payload, ["skip_reason", "reason"]) ?? "student_selected_skip_activity"
        : null,
      selected_navigation_destination: payloadString((feedbackUnavailableEvent ?? activitySkippedEvent)?.payload, [
        "destination",
        "selected_navigation_destination",
        "destination_type"
      ]),
      assessment_completion_reason:
        (feedbackUnavailableEvent?.event_type === "initial_feedback_terminated" ? "ended_after_initial_feedback_failure" :
          payloadString(completionEvent?.payload, ["reason"]) === "initial_feedback_unavailable" ? "initial_feedback_unavailable" : completionEvent?.event_type) ??
        (attemptLifecycleStatus === "completed" ? "session_completed" : terminalReason),
      attempt_policy_version:
        payloadString(attemptStartedEvent?.payload, ["attempt_policy_version"]) ??
        "assessment-attempt-policy-v1",
      teacher_override_metadata: jsonString(teacherOverrideMetadata),
      actual_initial_item_count: initialItemCount(session),
      completed_initial_item_count: initialResponses.filter((response) => response.item_submitted_at).length,
      current_item_index: responses.length ? Math.max(...responses.map((response) => response.item.item_order)) : null,
      session_completion_status: session.status,
      session_limitations: [!responses.length ? "no_item_responses_recorded" : "", feedbackUnavailableEvent ? "initial_feedback_unavailable" : ""].filter(Boolean).join("|"),
      session_wall_clock_elapsed_ms: sessionTiming.session_wall_clock_elapsed_ms,
      session_observation_end_at: iso(sessionTiming.session_observation_end_at),
      session_observation_end_source: sessionTiming.session_observation_end_source,
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
      ...learningProfileSummary(profile),
      ...conversationUpdateSummary(session),
      ...(profile ? profileRecordProvenance(profile) : {}),
      ...(profile ? profileEvidenceCounts(profile) : {}),
      evidence_sufficiency: profile?.evidence_sufficiency ?? null,
      interpretation_limitations: profile
        ? "interpretive_assessment_specific_signal_not_stable_trait"
        : "no_valid_profile_output_recorded",
      unsupported_correct_response_count: unsupportedCorrectCount,
      estimated_guessing_risk_max: null
    } satisfies CsvRow, profile?.item_level_evidence, decisions);
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
        // Product rows describe current accepted responses, including attempts
        // that ended before package submission. Sealed baselines stay separate.
        const latestTempting = session.conversation_turns
          .filter(turn => turn.actor_type === "student" && turn.item?.item_public_id === response.item.item_public_id)
          .sort((a, b) => b.sequence_index - a.sequence_index)
          .map(turn => acceptedTemptingEvidence(turn.structured_payload)).find(Boolean);
        const temptingEvidence = latestTempting ?? evidence;
        const timing = deriveItemTiming({
          events: itemEvents,
          item_started_at: response.item_started_at,
          item_submitted_at: response.item_submitted_at,
          persisted_item_response_time_ms: response.item_response_time_ms
        });
        // The value interpretation v8's rapid-selection indicator read (browser, else sealed package).
        const firstOption = firstOptionSelectionTiming(itemEvents, evidence.response_time_answer_ms);
        const itemProcess = itemProcessColumns({
          events: itemEvents,
          first_explanation: typeof evidence.reasoning_text_initial === "string" ? evidence.reasoning_text_initial : null,
          final_explanation: response.reasoning_text
        });
        // Item administration v4 records collection decisions, not quality levels.
        const itemAdministration = itemAdministrationV4Fields(itemEvents);
        const aiFlaggedInsufficientKnowledge = countEvents(itemEvents, ["insufficient_knowledge_marked"]) > 0;
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
          no_tempting_option: typeof temptingEvidence.no_tempting_option === "boolean" ? temptingEvidence.no_tempting_option : null,
          tempting_option: typeof temptingEvidence.tempting_option === "string" ? temptingEvidence.tempting_option : null,
          tempting_option_reason: typeof temptingEvidence.tempting_option_reason === "string" ? temptingEvidence.tempting_option_reason : null,
          insufficient_knowledge_selected: countEvents(itemEvents, ["idk_selected", "insufficient_knowledge_marked"]) > 0,
          // R2: split the combined flag. "E" is the "I don't know yet" choice unless the
          // administered item had its own option E.
          final_idk_selected: response.selected_option === "E" && !snapshotHasOptionE(response),
          ever_idk_selected: countEvents(itemEvents, ["idk_selected"]) > 0,
          // Blank (not false) when every check is a v4 record: v4 never judges insufficient knowledge.
          ai_flagged_insufficient_knowledge: itemAdministration.v4_only && !aiFlaggedInsufficientKnowledge ? null : aiFlaggedInsufficientKnowledge,
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
          ...firstOption,
          post_option_completion_time_ms: timing.post_option_completion_time_ms,
          reasoning_prompted_at: iso(timing.reasoning_prompted_at),
          reasoning_started_at: iso(timing.reasoning_started_at),
          reasoning_submitted_at: iso(timing.reasoning_submitted_at),
          reasoning_prompt_to_submission_ms: timing.reasoning_elapsed_time_ms,
          reasoning_elapsed_time_ms: timing.reasoning_elapsed_time_ms,
          reasoning_active_time_ms: timing.reasoning_active_typing_time_ms,
          reasoning_active_typing_time_ms: timing.reasoning_active_typing_time_ms,
          reasoning_input_elapsed_time_ms: timing.reasoning_input_elapsed_time_ms,
          reasoning_start_latency_ms: timing.reasoning_start_latency_ms,
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
          option_selection_count: canonicalActionCount(itemEvents, ["option_selected", "option_clicked", "transfer_answer_selected"]),
          option_revision_count: countEvents(itemEvents, ["answer_changed"]),
          reasoning_submission_count: countEvents(itemEvents, ["reasoning_submitted", "transfer_reasoning_submitted"]),
          reasoning_revision_count: countEvents(itemEvents, ["reasoning_revised", "reasoning_edited"]),
          confidence_selection_count: canonicalActionCount(itemEvents, ["confidence_selected", "confidence_clicked", "transfer_confidence_clicked"]),
          confidence_revision_count: itemEvents.filter(isConfidenceRevisionEvent).length,
          navigation_event_count: countEvents(itemEvents, ["navigation_event"]),
          page_hidden_count: summarizePageVisibility(itemEvents).hidden_count,
          ...itemProcess,
          typing_activity_event_count: countEvents(itemEvents, ["typing_activity_summary"]),
          response_quality_check_count: countEvents(itemEvents, ["response_quality_checked"]),
          response_quality_rejection_count: countEvents(itemEvents, ["response_quality_rejected"]),
          insufficient_knowledge_count: countEvents(itemEvents, ["idk_selected", "insufficient_knowledge_marked"]),
          procedural_clarification_count: countEvents(itemEvents, ["procedural_clarification_request", "clarification_answered"]),
          content_question_count: countEvents(itemEvents, ["content_question_deferred"]),
          invalid_help_request_count: countEvents(itemEvents, ["invalid_help_request"]),
          ...itemAdministration.columns,
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
          row.answer_review_explanation = answerReviewExplanation(packageEvidence.get(response.item.item_public_id));
        }
        rows.push(row);
      }
    }
  }
  return rows;
}

function assessmentSummaryRows(source: ExportSourceIdentity, sessions: AnalysisSession[], supplemental: SupplementalRecords,
  decisions: CurrentItemDecisions = new Map()) {
  const sessionRowsById = new Map(
    sessionRows(source, sessions, supplemental, decisions).map((row) => [String(row.session_public_id), row])
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
      ...Object.fromEntries(UNDERSTANDING_SUMMARY_COLUMNS.map(column => [column, row[column] ?? null])),
      ...Object.fromEntries(CONVERSATION_UPDATE_SUMMARY_COLUMNS.map(column => [column, row[column] ?? null])),
      ...Object.fromEntries(INTERPRETATION_V8_PROFILE_COLUMNS.map(column => [column, row[column] ?? null])),
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
      const positions = presentedItemPositions(session.process_events.map(event => ({ ...event, item_public_id: event.item?.item_public_id })));
      const visibilityByStart = new Map(
        visibilityIntervals.map((interval) => [`${interval.browser_tab_id ?? "legacy"}:${interval.start_at.getTime()}`, interval])
      );
      return session.process_events.map((event, index) => {
      const payload = asRecord(event.payload);
      const response = session.concept_unit_sessions.flatMap((entry) => entry.item_responses)
        .find((entry) => entry.item.item_public_id === event.item?.item_public_id);
      const duration = event.pause_duration_ms ?? event.visibility_duration_ms ?? payloadNumber(payload, ["duration_ms"]);
      const timestamp = eventTimestamp(event);
      const visibilityInterval = timestamp ? visibilityByStart.get(`${payload.browser_tab_id ?? "legacy"}:${timestamp.getTime()}`) : undefined;
      return {
        event_public_id: `event_${sha({ namespace: "research-process-event-v2", id: event.id })}`,
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        student_id: researchStudentId(session.user.user_id),
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_snapshot_public_id: assessmentSnapshotId(session),
        item_public_id: event.item?.item_public_id ?? null,
        item_snapshot_public_id: response ? itemSnapshotId(response) : null,
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
        timing_contract_version: payloadString(payload, ["timing_contract_version"]) ?? "legacy_unversioned",
        timing_source_version: payloadString(payload, ["timing_source_version"]) ?? "legacy_unversioned",
        timing_quality_status: payloadString(payload, ["timing_quality_status"]),
        item_position: event.item ? positions.get(event.item.item_public_id) ?? null : null,
        authoring_item_order: event.item?.item_order ?? null,
        actual_total_item_count: initialItemCount(session) + session.concept_unit_sessions.flatMap((entry) => entry.item_responses).filter((entry) => !isInitialResponse(entry)).length,
        payload_source: payloadString(payload, ["source"]),
        payload_action_status: payloadString(payload, ["action_status", "status"]),
        payload_prompt_type: payloadString(payload, ["prompt_type", "message_type"]),
        payload_text_length: payloadNumber(payload, ["text_length", "message_length", "reasoning_length"]),
        payload_selected_option: payloadString(payload, ["selected_option", "option", "answer"]),
        payload_confidence_rating: payloadString(payload, ["confidence_rating", "confidence"]),
        payload_no_tempting_option: payloadBoolean(payload, ["no_tempting_option"]),
        client_event_id: payloadString(payload, ["client_event_id"]),
        browser_tab_id: payloadString(payload, ["browser_tab_id"]),
        payload_key_count: payloadNumber(payload, ["key_count"]),
        payload_backspace_count: payloadNumber(payload, ["backspace_count"]),
        payload_enter_key_count: payloadNumber(payload, ["enter_key_count"]),
        payload_pasted_text_length_band: payloadString(payload, ["pasted_text_length_band"]),
        payload_target_kind: payloadString(payload, ["target_kind"]),
        payload_clipboard_type_count: payloadNumber(payload, ["clipboard_type_count"]),
        payload_includes_plain_text: payloadBoolean(payload, ["includes_plain_text"]),
        payload_paste_blocked: payloadBoolean(payload, ["paste_blocked"]),
        payload_unanswered_message_count: payloadNumber(payload, ["unanswered_message_count"]),
        payload_replaced_other_tab: payloadBoolean(payload, ["replaced_other_tab"]),
        payload_delivery_gap_count: payloadNumber(payload, ["delivery_gap_count"]),
        duration_ms: duration,
        visibility_duration_ms: event.visibility_duration_ms,
        visibility_interval_start_at: iso(visibilityInterval?.start_at ?? null),
        visibility_interval_end_at: iso(visibilityInterval?.end_at ?? null),
        visibility_interval_duration_ms: visibilityInterval?.duration_ms ?? null,
        visibility_interval_quality_status: visibilityInterval?.quality_status ?? null,
        pause_duration_ms: event.pause_duration_ms,
        limitation_code: event.item && !response ? "raw_payload_excluded|item_snapshot_unavailable" : "raw_payload_excluded"
      } satisfies CsvRow;
    })
    }
  );
}

function conversationRows(sessions: AnalysisSession[]) {
  return sessions.flatMap((session) => {
    const conversationTopics = new Set(session.formative_conversation_sessions.map(entry => entry.concept_unit_session_db_id));
    const visibility = (turn: AnalysisSession["conversation_turns"][number]) => conversationVisibility(
      turn.structured_payload, Boolean(turn.concept_unit_session_db_id && conversationTopics.has(turn.concept_unit_session_db_id)));
    return session.conversation_turns.map((turn, index) => {
      const studentVisibility = visibility(turn);
      const nextStudentTurn = session.conversation_turns
        .slice(index + 1)
        .find((candidate) => candidate.actor_type === "student" && visibility(candidate) !== "internal_only");
      const eligiblePrompt = studentVisibility !== "internal_only" && turn.actor_type !== "student" && Boolean(turn.message_text?.trim());
      const promptLatency =
        eligiblePrompt && nextStudentTurn ? diff(ms(turn.created_at), ms(nextStudentTurn.created_at)) : null;
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
        student_visibility: studentVisibility,
        conversation_visibility_version: CONVERSATION_VISIBILITY_VERSION,
        response_or_action_latency_ms: promptLatency,
        prompt_to_student_action_latency_ms: promptLatency,
        latency_recorded_on_turn: eligiblePrompt ? "prompt_turn" : "not_applicable",
        response_text_present: Boolean(turn.message_text?.trim()),
        turn_status: "recorded",
        limitation_code: ["structured_payload_excluded", "server_record_time_not_client_display_time",
          "elapsed_time_not_active_work_time", studentVisibility === "internal_only" ? "internal_turn_not_student_prompt" :
            studentVisibility === "legacy_unspecified" ? "legacy_visibility_unspecified_not_proof_of_exposure" : "visibility_not_proof_of_exposure"].join("|")
      } satisfies CsvRow;
    });
  });
}

function agentAndActivityRows(sessions: AnalysisSession[], supplemental: SupplementalRecords,
  decisions: CurrentItemDecisions = new Map()) {
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
        // Interpretation v8 profiles: legacy label columns blank, v8 summary columns added.
        rows.push(withInterpretationV8ProfileColumns("agent_activity_records", {
          record_type: "profile_result",
          authority_status: profileRecordProvenance(profile).profile_valid_for_learning_analysis
            ? "validated_profile_record" : "non_diagnostic_profile_artifact",
          ...profileRecordProvenance(profile),
          ...profileEvidenceCounts(profile),
          reasoning_quality_category: nestedProfileValue(evidenceProfileV2(profile), "reasoning_quality"),
          confidence_calibration_category: nestedProfileValue(evidenceProfileV2(profile), "confidence_calibration"),
          evidence_profile_schema_version: profileString(evidenceProfileV2(profile), "profile_schema_version"),
          session_public_id: session.session_public_id,
          research_student_id: researchStudentId(session.user.user_id),
          student_id: researchStudentId(session.user.user_id),
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          understanding_category: profile.integrated_diagnostic_profile,
          engagement_category: profile.engagement_profile,
          response_profile: profile.ability_profile,
          initial_profile_transfer_rule: initialProfileTransferRule(profile),
          evidence_sufficiency: profile.evidence_sufficiency,
          uncertainty: profile.profile_type === "updated" ? "updated_profile" : "initial_profile",
          status: "recorded",
          started_at: iso(profile.created_at),
          completed_at: iso(profile.created_at),
          limitations: profileRecordProvenance(profile).profile_unavailable_reason ?? "interpretive_assessment_specific_profile"
        }, profile.item_level_evidence, decisions));
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
        // What interpretation v8 judged against: the first sealed package holding the item.
        const sealed = firstSealedPackageItem(conceptUnitSession, response.item.item_public_id);
        const row: CsvRow = {
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          assessment_title: session.assessment.title,
          assessment_diagnostic_focus: session.assessment.diagnostic_focus,
          topic_learning_objective: payloadString(sealed?.topic, ["learning_objective"]),
          topic_description: payloadString(sealed?.topic, ["related_concept_description"]),
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
          option_e_text: options.get("E") ?? null,
          option_f_text: options.get("F") ?? null,
          media_public_ids: mediaPublicIds(response),
          student_alt_text: media.map((asset) => asset.student_alt_text ?? asset.alt_text_or_description).filter(Boolean).join("; "),
          snapshot_created_at: iso(response.created_at)
        };
        if (includeRestricted) {
          row.teacher_llm_media_description = media
            .map((asset) => asset.teacher_llm_media_description)
            .filter(Boolean)
            .join("; ");
          Object.assign(row, itemReferenceColumns(sealed?.item, response.item.item_public_id));
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

function formativeConversationSessionRows(sessions: AnalysisSession[], decisions: CurrentItemDecisions = new Map()) {
  return sessions.flatMap((session) =>
    session.formative_conversation_sessions.map((conversation) => {
      const canonicalTransitions =
        canonicalPersistedFormativeConversationProfileTransitions(
          conversation.profile_transitions
        );
      const latestTransition =
        latestPersistedFormativeConversationProfileTransition(
          canonicalTransitions
        );
      const canonicalCurrentProfile =
        latestTransition?.updated_student_profile ??
        conversation.initial_student_profile;
      const platformLifecycleHandoff = conversation.review_signals.find(
        (signal) => signal.signal_type === "platform_lifecycle_handoff"
      );
      const studentFormativeTurnCount = conversation.conversation_turns.filter(
        (turn) => turn.actor_type === "student"
      ).length;
      const attemptLifecycle = resolveCanonicalAttemptLifecycle(session);
      const maxStudentTurns = formativeConversationTurnLimit({
        ...conversation,
        status: attemptLifecycle.terminal ? "ended" : conversation.status
      });
      const participation = conversationParticipation(conversation, session.process_events);
      // Interpretation v8 profiles: legacy label columns blank, v8 summary columns added.
      return withInterpretationV8ProfileColumns("formative_conversation_sessions", {
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        assessment_public_id: session.assessment.assessment_public_id,
        concept_unit_public_id:
          conversation.concept_unit_session.concept_unit
            .concept_unit_public_id,
        conversation_public_id: conversation.conversation_public_id,
        conversation_status: conversation.status,
        ...openingOutcome(conversation.message_receipts, conversation.conversation_turns),
        ...participation,
        ...conversationEngagement(conversation.conversation_turns, participation.first_tutor_display_received_at),
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
        student_formative_turn_count: studentFormativeTurnCount,
        current_student_turn_index: studentFormativeTurnCount,
        max_student_turns: maxStudentTurns,
        final_allowed_turn:
          studentFormativeTurnCount ===
          maxStudentTurns,
        another_student_turn_available:
          !attemptLifecycle.terminal &&
          conversation.status === "active" &&
          studentFormativeTurnCount <
            maxStudentTurns,
        lifecycle_termination_source: platformLifecycleHandoff
          ? "platform_lifecycle"
          : conversation.lifecycle_reason?.startsWith(
                "llm_terminal_recommendation:"
              )
            ? "llm_terminal_recommendation"
            : conversation.lifecycle_reason
              ? "student_or_session_lifecycle"
              : null,
        lifecycle_termination_reason:
          platformLifecycleHandoff?.reason_code ??
          conversation.lifecycle_reason,
        end_reason: conversationEndReason(conversation, {
          completed: attemptLifecycle.canonical_status === "completed",
          terminal: attemptLifecycle.terminal
        }),
        semantic_teacher_assistance_recommended:
          persistedFormativeConversationOutcome(canonicalTransitions) ===
          "teacher_assistance_recommended",
        platform_lifecycle_handoff:
          platformLifecycleHandoff?.signal_public_id ?? null,
        lifecycle_event_count: conversation.lifecycle_events.length,
        agent_call_count: conversation.agent_calls.length,
        intervention_count: conversation.interventions.length,
        profile_transition_count:
          canonicalTransitions.length,
        profile_reassessment_status: profileReassessmentStatus({
          validated_transition_count: canonicalTransitions.length,
          student_turn_count: studentFormativeTurnCount,
          conversation_status: attemptLifecycle.terminal ? "ended" : conversation.status
        }),
        ...(canonicalCurrentProfile ? profileRecordProvenance(canonicalCurrentProfile) : {}),
        initial_profile_record_id: conversation.initial_student_profile
          ? profileRecordIdentity(conversation.initial_student_profile.id) : null,
        current_profile_record_id: canonicalCurrentProfile
          ? profileRecordIdentity(canonicalCurrentProfile.id) : null,
        latest_profile_transition_public_id:
          latestTransition?.transition_public_id ?? null,
        validated_formative_outcome:
          persistedFormativeConversationOutcome(
            canonicalTransitions
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
      }, conversation.initial_student_profile?.item_level_evidence, decisions);
    })
  );
}

function formativeConversationTurnRows(sessions: AnalysisSession[]) {
  return sessions.flatMap((session) =>
    session.formative_conversation_sessions.flatMap((conversation) => {
      const receiptByStudentTurnId = new Map(
        conversation.message_receipts.flatMap((receipt) =>
          receipt.student_turn_db_id
            ? [[receipt.student_turn_db_id, receipt] as const]
            : []
        )
      );
      return conversation.conversation_turns.map((turn) => {
        const telemetry = turn.formative_conversation_turn_telemetry;
        const inputTelemetry = turn.formative_conversation_input_telemetry;
        const payload = asRecord(turn.structured_payload);
        const responseReceipt =
          turn.actor_type === "student"
            ? receiptByStudentTurnId.get(turn.id) ?? null
            : null;
        return {
          session_public_id: session.session_public_id,
          research_student_id: researchStudentId(session.user.user_id),
          conversation_public_id: conversation.conversation_public_id,
          response_receipt_public_id:
            responseReceipt?.receipt_public_id ?? null,
          agent_call_public_id:
            telemetry?.agent_call?.agent_call_public_id ??
            responseReceipt?.agent_calls[0]?.agent_call_public_id ??
            null,
          turn_sequence_index: turn.sequence_index,
          conversation_local_turn_sequence_index:
            telemetry?.conversation_local_turn_sequence_index ?? null,
          actor_type: turn.actor_type,
          actor_name:
            turn.actor_type === "agent"
              ? turn.agent_name ?? "formative_conversation_agent"
              : "student",
          message_type: conversationMessageType(turn.actor_type, payload),
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
          assistant_response_status:
            responseReceipt?.assistant_response_status ?? null,
          assistant_response_retry_count:
            responseReceipt?.assistant_response_retry_count ?? null,
          assistant_response_failure_category:
            responseReceipt
              ?.assistant_response_last_failure_category ?? null,
          assistant_response_failed_at: iso(
            responseReceipt?.assistant_response_last_failed_at
          ),
          created_at: iso(turn.created_at),
          turn_started_at: iso(telemetry?.turn_started_at),
          turn_submitted_at: iso(telemetry?.turn_submitted_at),
          response_time_ms: telemetry?.response_time_ms ?? null,
          ...separateConversationTiming(turn.actor_type, inputTelemetry, telemetry?.agent_call?.latency_ms),
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
      });
    })
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
        agent_call_public_id:
          event.agent_call?.agent_call_public_id ?? null,
        agent_name: event.agent_name,
        failure_category: event.failure_category,
        retry_count: event.retry_count,
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
        response_receipt_public_id:
          call.formative_conversation_message_receipt
            ?.receipt_public_id ?? null,
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
      canonicalPersistedFormativeConversationProfileTransitions(
        conversation.profile_transitions
      ).map((transition) => {
        const profileSnapshot = parseFormativeConversationProfileSnapshot(
          transition.profile_snapshot
        );
        return {
        transition_public_id: transition.transition_public_id,
        prior_profile_record_id: profileRecordIdentity(transition.prior_student_profile.id),
        updated_profile_record_id: profileRecordIdentity(transition.updated_student_profile.id),
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
        prior_confidence_alignment_scope: profileRecordProvenance(transition.prior_student_profile).profile_confidence_alignment_scope,
        prior_misconception_indicators: JSON.stringify(
          transition.prior_student_profile.misconception_indicators
        ),
        prior_misconception_claim_catalog: JSON.stringify(
          parseCanonicalMisconceptionClaimCatalog(
            transition.prior_student_profile.misconception_indicators
          )
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
        updated_confidence_alignment_scope: profileRecordProvenance(transition.updated_student_profile).profile_confidence_alignment_scope,
        updated_misconception_indicators: JSON.stringify(
          transition.updated_student_profile.misconception_indicators
        ),
        updated_misconception_claim_catalog: JSON.stringify(
          profileSnapshot?.misconception_claim_catalog ?? null
        ),
        misconception_claim_dispositions: JSON.stringify(
          profileSnapshot?.misconception_claim_dispositions ?? []
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
        };
      })
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

// Keys are "dataset.variable" or a variable shared by the formative_conversation_* files.
const FORMATIVE_CONVERSATION_DEFINITIONS: Record<string, string> = {
  session_public_id: "Public identifier of the assessment attempt the conversation belongs to; joins sessions.csv.",
  research_student_id: "Pseudonymous student join key, identical to sessions.csv research_student_id under the same pseudonymization configuration; not a login identifier.",
  assessment_public_id: "Public identifier of the mini-test version (assessment) of the attempt.",
  concept_unit_public_id: "Public identifier of the topic (concept unit) the conversation is about; an attempt has at most one conversation per topic.",
  conversation_public_id: "Public identifier of the learning conversation (one per topic in an attempt); joins the formative_conversation_*.csv files and feedback_turn_records.csv.",
  conversation_status: "Stored status of the conversation record: active, paused, ended, or completed and teacher_assistance_recommended (runtimes before feedback v8 only). It stays active or paused when the attempt is finished while the conversation is open; use end_reason.",
  opening_status: "Outcome of the system's opening message. delivered: the opening was saved to the transcript (display: first_tutor_display_received_at). failed: a retryable failure was recorded (provider error, rejected output, saving error or usage limit). blocked: a failure recorded as not retryable, mostly the platform refusing to call the model (for example feedback_v8_not_approved when the approved prompt hash is not configured, feedback_v8_live_calls_disabled or feedback_v8_configuration_*). pending: generation reserved within the 6-minute generation window at export. interrupted: reserved for more than 6 minutes without a saved opening or recorded failure. not_requested: no opening was requested (preparation failed for good and saved the fallback profile, preparation had not reached the opening at export, or a runtime without an opening step). Every value except delivered is a system outcome, not student non-engagement.",
  opening_failure_code: "Safe failure code of the opening: the current failure code of the opening receipt or, after a successful retry, the last recorded failure (a delivered opening can carry the code of an earlier failure). Examples: feedback_v8_not_approved, formative_conversation_opening_validation_failed, formative_conversation_opening_generation_failed. Blank when no failure was recorded.",
  student_participated: "True when the student sent at least one message in the conversation. False with opening_status delivered: the student received the opening but did not write (display in displayed_tutor_reply_count, ending in end_reason).",
  last_turn_at: "Server save time of the conversation's latest student or tutor message; blank when no message was saved.",
  engaged_duration_ms: "Span of the student-facing conversation: from the first display of a tutor message (first_tutor_display_received_at, or first_student_message_at when that is earlier) to last_turn_at; without a display receipt it starts at the first saved message, normally the opening. Includes pauses and tutor generation time. Reading after the last message is not observed, so a student who read the opening and stopped has 0. Blank without saved messages.",
  end_reason: "How the conversation ended, from the stored status and lifecycle reason and the attempt state. student_ended: the student chose End. student_ended_attempt: the student ended the whole attempt while the conversation was open. turn_limit_reached: the student used the last allowed message (lifecycle_termination_source llm_terminal_recommendation, also for feedback v8, or platform_lifecycle when the final reply could not be produced). closed_by_system: another platform close. attempt_finished_while_active: the attempt was finished while the conversation was open; the record keeps status active or paused and no reason. attempt_ended_while_active: the attempt was ended by another path (for example by an instructor) while the conversation was open. still_active: open (active or paused) at export. other: any other stored reason, including closes recorded by runtimes before feedback v8.",
  "formative_conversation_sessions.started_at": "When the system created the conversation record, during preparation after the student submitted the topic's answers. It precedes the opening message and its display, so it does not mark when the student saw the conversation.",
  "formative_conversation_sessions.last_activity_at": "Server time of the latest activity stored on the conversation record (saved messages, pause, resume or close).",
  paused_at: "Time of the student's latest pause; cleared on resume and when the attempt is ended, so it is set when the conversation is paused at export or was ended while paused. Pause history: formative_conversation_events.csv and pause_episodes.csv.",
  "formative_conversation_sessions.completed_at": "When the conversation reached completed status (runtimes before feedback v8 only); feedback v8 conversations close with ended_at.",
  ended_at: "When the conversation was closed (student End, student ended the attempt, turn limit or platform close). Blank for open conversations, including those left open when the attempt was finished (end_reason attempt_finished_while_active).",
  turn_count: "Number of saved student and tutor messages in the conversation, including the opening and any platform handoff message (its rows in formative_conversation_turns.csv).",
  lifecycle_event_count: "Number of lifecycle events recorded for the conversation (its rows in formative_conversation_events.csv).",
  "formative_conversation_sessions.agent_call_count": "Number of model calls (AgentCall rows) linked to the conversation: openings and replies, including failed, rejected and retried calls (its rows in formative_conversation_llm_calls.csv).",
  intervention_count: "Number of intervention records for the conversation (its rows in formative_conversation_interventions.csv); only runtimes before feedback v8 create them.",
  profile_transition_count: "Number of validated profile transitions recorded during the conversation (its rows in formative_conversation_profile_transitions.csv).",
  initial_learning_profile: "integrated_diagnostic_profile category of the profile the conversation started from (the profile saved from the submitted mini-test).",
  current_learning_profile: "integrated_diagnostic_profile category of the profile created by the latest validated transition, otherwise of the initial profile.",
  prior_learning_profile: "integrated_diagnostic_profile category of the profile before this transition.",
  updated_learning_profile: "integrated_diagnostic_profile category of the profile created by this transition.",
  turn_sequence_index: "ConversationTurn.sequence_index: database-wide transcript order (unique and increasing, not consecutive within a conversation). Orders turns; joins feedback_turn_records.csv turn_sequence_index and feedback_exposure_events.csv source_turn_sequence_index within session_public_id.",
  actor_type: "student for student messages; agent for tutor messages (opening, replies and the platform handoff message).",
  actor_name: "student for student messages; for tutor messages the stored agent name: formative_conversation_agent (opening and replies, including feedback v8) or platform_lifecycle (handoff message).",
  message_type: "opening (the system's opening message), reply (tutor reply to a student message), student (student message) or lifecycle_handoff (platform message closing the conversation at the turn limit when the final reply could not be produced). Any other stored structured_payload.message_type is copied; blank for tutor messages without a stored type.",
  generation_source: "How the tutor message was produced (structured_payload.generation_source), for example live_llm (live model output), deterministic_test (local test output, never live model evidence) or platform_lifecycle (fixed handoff message); blank for student messages.",
  validator_status: "Validation recorded with the tutor message: opening_validated (opening), passed (reply) or lifecycle_fail_safe (handoff message); blank for student messages. Rejected drafts are not saved as turns (see formative_conversation_llm_calls.csv).",
  fallback_used: "True when a scripted fallback replaced model output for this tutor message; the current runtime saves only validated model output and records false. Blank for student messages.",
  "formative_conversation_turns.created_at": "Server time the message was saved to the transcript.",
  turn_started_at: "Tutor messages: start of the linked model call. Student messages: browser time of the first nonempty input for the message; blank without browser telemetry.",
  turn_submitted_at: "Tutor messages: completion of the linked model call. Student messages: browser time of the first Send, otherwise the server save time.",
  message_length_chars: "Length of the saved message in UTF-16 code units.",
  input_token_count: "Provider-reported input tokens of the model call that produced this tutor message; blank for student messages and when not reported.",
  output_token_count: "Provider-reported output tokens of the model call that produced this tutor message; blank for student messages and when not reported.",
  typing_started_at: "Student messages: browser time of the first nonempty input for the message; blank for tutor messages and without input telemetry.",
  typing_ended_at: "Student messages: browser time of the first Send of the message; blank for tutor messages and without input telemetry.",
  typing_duration_method: "Method of the student input timing: elapsed_monotonic_first_input_to_submit for current browsers; historical methods are kept. Blank for tutor messages.",
  final_message_length_chars: "Browser-reported length of the accepted, trimmed student message in UTF-16 code units; blank for tutor messages and without input telemetry.",
  event_public_id: "Public identifier of the lifecycle event; stable across exports. Use it to deduplicate.",
  event_sequence_index: "Stored lifecycle-event sequence (database-wide and increasing, not consecutive within a conversation); orders events.",
  "formative_conversation_events.agent_name": "Agent recorded with the event: formative_conversation_agent for model-call and reply-failure events; blank for browser, student and most system events.",
  "formative_conversation_events.retry_count": "Retry count recorded with the event: for agent_call_started and agent_call_completed the AgentCall retry_count; for agent_call_failed and assistant_response_failed the reply's assistant_response_retry_count (student or system retries after the first generation); 0 for system closes; blank for browser and student events.",
  "formative_conversation_events.occurred_at": "Occurrence time recorded with the event: the browser clock for frontend events, the server clock for backend, agent and system events.",
  "formative_conversation_events.created_at": "Server time the event row was saved.",
  agent_call_index: "One-based order of the call among the conversation's model calls by creation time.",
  "formative_conversation_llm_calls.agent_name": "AI role recorded on the call: formative_conversation_agent for openings and replies in every runtime, including feedback v8.",
  agent_version: "Runtime version label of the call (formative-feedback-runtime-v8 for feedback v8).",
  provider: "Provider of the call: openai for live calls, mock for local test output (never live model evidence).",
  model_name: "Model identifier recorded for the call.",
  prompt_version: "Version of the instructions sent with the call (feedback v8: formative-opening-v8.2+formative-conversation-v8.2).",
  schema_version: "Output contract version (feedback v8: formative-feedback-v8).",
  context_version: "Version of the conversation context sent to the model.",
  call_status: "Outcome of the call: succeeded, invalid_output (output rejected by validation, after the allowed regeneration), failed (provider or transport failure), needs_review, or started (no outcome recorded).",
  output_validated: "True when the application accepted the call's output after schema and content validation.",
  "formative_conversation_llm_calls.retry_count": "Feedback v8 (schema_version formative-feedback-v8): one row per generation request; it holds up to two provider attempts (the first output and one regeneration after a rejected output or provider failure), and retry_count is the number of attempts after the first in this row; rejected drafts are in ai_call_audit.csv raw_output_json (restricted exports). A reply or opening retried after a terminal failure is a new row. Earlier runtimes: provider transport retries within the call.",
  "formative_conversation_llm_calls.started_at": "When the call started (its creation time when no start was recorded).",
  "formative_conversation_llm_calls.completed_at": "When the call finished; blank when no outcome was recorded.",
  transition_public_id: "Public identifier of the validated profile transition.",
  transition_version: "Version of the profile-transition record layout.",
  prior_profile_created_at: "Creation time of the profile before the transition.",
  updated_profile_created_at: "Creation time of the profile created by the transition.",
  source_turn_sequence_index: "turn_sequence_index of the tutor message whose model output recommended the transition.",
  source_agent_name: "AI role of the model call that recommended the transition.",
  transitioned_at: "When the transition was recorded.",
  intervention_public_id: "Public identifier of the intervention record.",
  strategy_type: "Strategy the conversation agent started for the intervention.",
  targeted_evidence_gap: "Evidence gap the intervention targeted, as written by the conversation agent.",
  status: "Intervention status: active, completed or abandoned.",
  "formative_conversation_interventions.started_at": "When the intervention started.",
  "formative_conversation_interventions.completed_at": "When the intervention ended; blank while active or when no end time was recorded."
};

export function formativeConversationDataDictionaryRows() {
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
    const v8Doc = interpretationV8ColumnDoc(dataset, variable);
    if (v8Doc) return v8Doc.definition;
    const participationDefinitions: Record<string, string> = {
      participation_observation_version: "Deterministic participation-observation projection version; no satisfaction or learning judgment.",
      tutor_reply_count: "Number of persisted tutor messages in this conversation; saving does not establish display.",
      displayed_tutor_reply_count: "Distinct persisted tutor turn sequence indexes with a matching conversation_public_id and display-ack-v2 acknowledgement. Zero means no such observations, not no reading.",
      first_tutor_display_received_at: "Earliest server receipt for a linked display-ack-v2 acknowledgement (formative_feedback_shown) of a tutor message in this conversation, normally the opening: the first display of a tutor message to the student. Partial viewport display, not reading time; blank when none was recorded. Start of engaged_duration_ms.",
      first_student_message_at: "Earliest persisted student turn created_at in this conversation (the student's first message); blank if no student message was recorded."
    };
    if (participationDefinitions[variable]) return participationDefinitions[variable];
    const documented = FORMATIVE_CONVERSATION_DEFINITIONS[`${dataset}.${variable}`] ?? FORMATIVE_CONVERSATION_DEFINITIONS[variable];
    if (documented) return documented;
    if ((variable.startsWith("profile_") || variable.endsWith("_profile_record_id") || variable.endsWith("confidence_alignment_scope")) && PROFILE_FIELD_DEFINITIONS[variable]) {
      return PROFILE_FIELD_DEFINITIONS[variable];
    }
    if (variable === "message_text") {
      return "Exact visible student or tutor message persisted in chronological order.";
    }
    if (variable === "typing_duration_ms") {
      return "Elapsed first nonempty input to the first submission, including pauses; not active typing. Current monotonic measurement is frozen on retries. Interpret historical records by typing_duration_method. Compatibility alias of student_input_elapsed_ms for elapsed methods.";
    }
    if (variable === "response_time_ms") {
      return "Legacy actor-dependent field. Prefer student_input_elapsed_ms and model_call_latency_ms. Student elapsed input and tutor provider latency measure different intervals; never pool actors or sum duplicate aliases.";
    }
    if (variable === "student_input_elapsed_ms") return "Student-only elapsed first nonempty input to submission; excludes subsequent system/AI waiting for new monotonic records. Includes pauses, not active typing or time reading before first input. Legacy wall-clock rows may include pre-persistence retries; use student_timing_status.";
    if (variable === "model_call_latency_ms") return "Tutor-only latency from the linked AgentCall. Provider operation latency, not pure model inference or total student-visible wait. Failed/retried calls remain in formative_conversation_llm_calls.csv; never add to an enclosing request wait.";
    if (variable === "student_timing_method") return "Student input measurement method retained from the source record. New browser records use elapsed_monotonic_first_input_to_submit; historical methods remain unchanged.";
    if (variable === "student_timing_status") return "monotonic_first_submission, legacy_wall_clock_retry_unverified, unavailable_or_different_method, or not_applicable. Describes instrumentation, not engagement or data authenticity.";
    if (variable === "observed_interval_duration_ms") {
      return "Optional explicitly supplied lifecycle interval; current browser navigation emits null. Do not interpret an empty field as zero or infer exact off-page time from server receipt timestamps.";
    }
    if (variable === "edit_count") {
      return "Current browser: input changes for which the previous draft was nonempty; the first change from an empty draft is excluded. This is not a count of conceptual revisions.";
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
    if (variable === "response_receipt_public_id") {
      return "Opaque public join key for the persisted student-message response lifecycle; client message IDs and internal database IDs are excluded.";
    }
    if (variable === "assistant_response_status") {
      return "Persisted lifecycle state for the tutor response associated with a student message: pending, retrying, failed, or completed.";
    }
    if (variable === "assistant_response_retry_count") {
      return "Count of idempotent tutor-generation retries after the initial generation attempt for this persisted student message.";
    }
    if (variable === "assistant_response_failure_category") {
      return "Safe terminal failure category for the latest unsuccessful tutor-generation attempt; raw provider errors and payloads are excluded. conversation_closed_before_reply means the student ended the conversation or the attempt while the reply was being generated, so the reply was not shown (not a system failure).";
    }
    if (variable === "assistant_response_failed_at") {
      return "Timestamp of the latest terminal tutor-generation failure for this persisted student message.";
    }
    if (variable === "failure_category") {
      return "Safe operational category recorded for a terminal formative response failure; it excludes raw provider errors and payloads.";
    }
    if (variable === "conversation_local_turn_sequence_index") {
      return "One-based persisted turn-telemetry order within this formative conversation.";
    }
    if (variable === "conversation_local_event_sequence_index") {
      return "One-based persisted lifecycle-event order within this formative conversation.";
    }
    if (
      variable === "student_formative_turn_count" ||
      variable === "current_student_turn_index"
    ) {
      return "Count of unique accepted persisted student-authored messages after the formative conversation began; assessment administration, tutor turns, retries, and replays are excluded.";
    }
    if (variable === "max_student_turns") {
      return "Pilot lifecycle limit for phase-local formative student turns; this is not a learning or mastery threshold.";
    }
    if (variable === "final_allowed_turn") {
      return "Whether the phase-local formative student turn equals the recorded maximum (12 for legacy histories; 30 for the current policy).";
    }
    if (variable === "another_student_turn_available") {
      return "Whether the platform lifecycle can accept another unique formative student message.";
    }
    if (variable === "lifecycle_termination_source") {
      return "Raw source label derived from the stored lifecycle reason: platform_lifecycle (platform handoff message), llm_terminal_recommendation (reason starting llm_terminal_recommendation:), student_or_session_lifecycle (any other stored reason), blank when none. The runtime also stores the turn-limit close as llm_terminal_recommendation:final_allowed_turn_terminal_recommendation_recorded, including for feedback v8, whose model never recommends ending: that value means the student reached the turn limit, not that the model ended the conversation. Open conversations carry their last pause or resume reason (student_or_session_lifecycle). Use end_reason for analysis.";
    }
    if (variable === "lifecycle_termination_reason") {
      return "Raw stored reason: the platform handoff reason code, otherwise the conversation's lifecycle_reason (for example student_ended_conversation, student_ended_attempt, llm_terminal_recommendation:final_allowed_turn_terminal_recommendation_recorded, platform_student_turn_limit_terminal_recommendation_unavailable, or student_paused / student_resumed on open conversations). Blank when no reason was stored (an open conversation never paused, including one left open when the attempt was finished). Operational provenance, not a learning-state judgment; use end_reason for analysis.";
    }
    if (variable === "semantic_teacher_assistance_recommended") {
      return "Whether a validated persisted LLM profile transition recommended teacher assistance.";
    }
    if (variable === "platform_lifecycle_handoff") {
      return "Public review-signal identifier for a platform turn-limit handoff; null when no such handoff occurred. This is not teacher_assistance_recommended.";
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
    if (variable.includes("misconception_claim_catalog")) {
      return "Versioned canonical misconception indicator and atomic claim identities with human-readable text and source evidence references for the named profile version.";
    }
    if (variable === "misconception_claim_dispositions") {
      return "ID-based resolved or retained disposition for every prior canonical misconception claim, including cited student-turn evidence and explanatory text.";
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
      return "Elapsed milliseconds from started_at, when the system created the conversation record (before the opening was generated or shown), to completion, end, or latest recorded activity. Includes opening generation, pauses and waits; for the student-facing span use engaged_duration_ms.";
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
    throw new Error(`Undocumented formative conversation variable: ${dataset}.${variable}`);
  };
  const rows = tables.flatMap((table) =>
    table.columns.map((variable) => ({
      dataset: table.dataset,
      variable,
      // Columns blank for interpretation v8 profiles say so (interpretation-v8-dictionary.ts).
      definition: [definition(table.dataset, variable), interpretationV8LegacyNote(table.dataset, variable)].filter(Boolean).join(" "),
      source_nature:
        interpretationV8ColumnDoc(table.dataset, variable)?.source_nature ??
        (variable.startsWith("profile_") || variable.endsWith("confidence_alignment_scope") ? "profile_provenance_projection" :
        table.phase === "profile_transition" ||
        /learning_profile|evidence_sufficiency/.test(variable)
          ? "validated_derived_interpretation"
          : /wall_clock_duration|engaged_duration|_count$|^(end_reason|opening_status|student_participated|last_turn_at)$/.test(variable)
            ? "derived_from_persisted_observations"
            : "directly_recorded_observable_or_operational"),
      analysis_phase: table.phase,
      calculation: ({
        response_time_ms: "Legacy alias. New student browser: rounded performance.now at first Send minus at first nonempty input, frozen per client_message_id. Tutor: provider latency. Read typing_duration_method for historical student formulas.",
        typing_duration_ms: "New monotonic method: rounded performance.now(first Send) - performance.now(first nonempty input), same document, frozen on retries. Wall-clock elapsed_first_input_to_submit: max(0, typing_ended_at - typing_started_at). Includes pauses; historical active_intervals is a different method. Null without input or for invalid/out-of-range duration.",
        typing_duration_method: "Current browser emits elapsed_monotonic_first_input_to_submit with valid duration, otherwise null; historical methods are preserved. On backwards wall-clock adjustment, raw typing UTC labels remain recorded but turn_started_at is null; monotonic duration is unchanged.",
        student_input_elapsed_ms: "Copy typing_duration_ms only for actor_type=student and one of the two elapsed first-input methods. Other methods/actors/missing telemetry remain null; no reconstruction from server timestamps.",
        model_call_latency_ms: "Copy linked AgentCall.latency_ms only for actor_type=agent. No inferred latency from transcript timestamps; absent linked call yields null.",
        student_timing_method: "Copy student's typing_duration_method; blank on other actors.",
        student_timing_status: "Agent/other actor => not_applicable; absent elapsed value or non-elapsed method => unavailable_or_different_method; monotonic method => monotonic_first_submission; legacy wall-clock method => legacy_wall_clock_retry_unverified.",
        edit_count: "Increment on input change if the previous draft length > 0; reset after successful submission. Not a keystroke or semantic revision count.",
        backspace_count: "Count observed Backspace/Delete keydown events before submission; reset after success. Touch/IME deletions may not emit these keys.",
        paste_event_count: "Count paste events before submission; reset after success. No clipboard contents recorded in this field.",
        paste_character_count: "Sum JavaScript clipboard plain-text .length over observed paste events; UTF-16 code units, not necessarily grapheme count.",
        final_message_length_chars: "JavaScript length of the accepted, trimmed student message; UTF-16 code units.",
        message_length_chars: "Stored telemetry length; fallback to persisted message_text.length, then 0 when text absent. UTF-16 code units.",
        wall_clock_duration_ms: "Conversation endpoint (completed_at, else ended_at, else last_activity_at) minus started_at (creation of the conversation record by the system); includes opening generation, pauses and system waits.",
        engaged_duration_ms: "MAX(0, last_turn_at - start). start = MIN(first_tutor_display_received_at, first_student_message_at) when a display receipt exists, else the created_at of the first exported turn. Blank without turns.",
        last_turn_at: "MAX(created_at) over the conversation's exported student and tutor turns.",
        student_participated: "student_formative_turn_count > 0.",
        end_reason: "Status active or paused: attempt completed (status completed, phase session_completed or completed_at) -> attempt_finished_while_active; attempt otherwise terminal (student_exited) -> attempt_ended_while_active; else still_active. Closed: lifecycle_reason student_ended_conversation -> student_ended; student_ended_attempt -> student_ended_attempt; starting llm_terminal_recommendation:final_allowed_turn or equal to platform_student_turn_limit_terminal_recommendation_unavailable -> turn_limit_reached; other platform_ reasons -> closed_by_system; otherwise other.",
        opening_status: "Opening receipt (client_message_id assistant-opening:formative-conversation-opening-v3) or a turn with message_type formative_conversation_opening: saved opening turn -> delivered; no receipt -> not_requested; receipt status failed -> blocked when response_payload.retryable is false, else failed; reserved and unchanged for more than 6 minutes at export -> interrupted; otherwise pending.",
        opening_failure_code: "Opening receipt failure_code, else its assistant_response_last_failure_category; blank without a receipt or failure.",
        message_type: "structured_payload.message_type mapped: formative_conversation_opening -> opening, formative_conversation_tutor_message -> reply, formative_conversation_student_message -> student, formative_conversation_lifecycle_handoff -> lifecycle_handoff; other stored values copied; student turns without a stored type -> student.",
        observed_interval_duration_ms: "Copy explicitly provided interval; no inferred interval in the current browser emitter.",
        latency_ms: "Copy recorded provider-call latency; not end-to-end student-visible waiting.",
        turn_sequence_index: "Persisted global transcript sequence; join and order within session, not a duration.",
        conversation_local_turn_sequence_index: "Persisted one-based telemetry sequence within conversation; may differ from global transcript sequence.",
        conversation_local_event_sequence_index: "Persisted one-based lifecycle sequence within conversation; distinct from global export order.",
        event_sequence_index: "Copy the stored database-wide event sequence; use it for ordering and event_public_id for deduplication.",
        assistant_response_retry_count: "Copy persisted retry count for the student's response receipt; a retry is not another student message."
      } as Record<string, string>)[variable] ?? "Copy the named persisted record/metadata or projection described in definition; no additional arithmetic in this export.",
      unit: variable.endsWith("_ms") ? "milliseconds" : variable.endsWith("_at") ? "UTC timestamp" : /_count$|_chars$/.test(variable) ? "count (see definition)" : "",
      missing_values: "Blank means unavailable/inapplicable; apply actor_type, collection version and lifecycle context. No rows can mean the phase was never reached. Do not impute zero.",
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
      calculation: "Not calculated or stored by the runtime. Requires a separate preregistered coding/derivation method.",
      unit: "not defined",
      missing_values: "Not a collected variable.",
      interpretation_caution:
        "This construct is not recorded as raw runtime data and requires a separate validated derivation method."
    }))
  ];
}

/** Every emitted file passes this scan; exported for database-free tests. */
export function assertAnalysisReadySafety(files: Array<{ path: string; data: string }>, includeRestricted: boolean) {
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
      if (RESTRICTED_ONLY_FILES.has(file.path)) {
        throw new Error(`Default analysis-ready export included restricted-only file ${file.path}.`);
      }
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
        "data_coverage.csv",
        "data_coverage_notes.txt",
        "response_stage_events.csv",
        "response_stage_visits.csv",
        "response_submission_timing.csv",
        "item_behavior_summary.csv",
        "response_revision_history.csv",
        "feedback_exposure_events.csv",
        "response_stage_data_dictionary.csv",
        "response_stage_notes.txt",
        "sessions.csv",
        "item_responses.csv",
        "process_events.csv",
        "conversation_turns.csv",
        "agent_activity_records.csv",
        "profile_item_evidence.csv",
        "profile_data_dictionary.csv",
        "formative_conversation_sessions.csv",
        "formative_conversation_turns.csv",
        "formative_conversation_events.csv",
        "pause_episodes.csv",
        "pause_episode_data_dictionary.csv",
        "attempt_submission_items.csv",
        "attempt_records.csv",
        "attempt_paired_changes.csv",
        "attempt_class_summaries.csv",
        "attempt_data_dictionary.csv",
        "attempt_comparison_notes.txt",
        "research_cohort_template.csv",
        "human_review_template.csv",
        "external_outcomes_template.csv",
        "study_template_dictionary.csv",
        "research_study_notes.txt",
        "mini_test_catalog.csv",
        "student_roster.csv",
        "student_participation_summary.csv",
        "formative_conversation_llm_calls.csv",
        "formative_conversation_profile_transitions.csv",
        "formative_conversation_interventions.csv",
        "formative_conversation_data_dictionary.csv",
        "interpretation_item_ratings.csv",
        "interpretation_claims.csv",
        "interpretation_summaries.csv",
        "feedback_turn_records.csv",
        "item_review_decisions.csv",
        INTERPRETATION_V8_NOTES_FILE,
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
                canonicalPersistedFormativeConversationProfileTransitions(
                  conversation.profile_transitions
                ).length,
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

export type AnalysisReadyExportInput = {
  teacher_user_db_id: string;
  scope: "all_authorized" | "selected_assessment" | "selected_student" | "selected_session";
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
  include_incomplete_sessions?: boolean;
  include_restricted_fields?: boolean;
  /**
   * Consent filter: when given, every file keeps only students whose study code (XXXX-XXXX,
   * hyphen optional, any case) is listed; mini_test_catalog.csv stays complete.
   */
  include_study_codes?: string[];
};

/** Normalized consent list, or null when no filter was requested; malformed codes are rejected. */
function requestedStudyCodes(values: string[] | undefined) {
  if (values === undefined) return null;
  const { codes, invalid } = parseStudyCodeList(values);
  if (invalid.length) {
    throw new ContentServiceError("validation_failed",
      `These entries are not study codes (expected XXXX-XXXX with digits 0-9 and letters A-F): ${invalid.slice(0, 10).join(", ")}${invalid.length > 10 ? ` and ${invalid.length - 10} more` : ""}.`,
      400, { invalid_study_code_count: invalid.length });
  }
  if (!codes.length) throw new ContentServiceError("validation_failed", "The study-code list is empty.", 400);
  if (codes.length > MAX_INCLUDED_STUDY_CODES) {
    throw new ContentServiceError("validation_failed", `At most ${MAX_INCLUDED_STUDY_CODES} study codes can be listed.`, 400);
  }
  return codes;
}

type InterpretationV8CallRecords = Awaited<ReturnType<typeof loadInterpretationV8CallRecords>>;
type InterpretationV8Context = {
  /** The instructor's current item decisions for the items of these sessions, by item_public_id. */
  decisions: CurrentItemDecisions;
  /** Profiling and feedback v8 calls and review signals, by session_public_id. */
  calls: Map<string, InterpretationV8CallRecords>;
};

/** The pure v8 builders' view of one loaded session (interpretation-v8-export.ts). */
function interpretationV8ExportSession(session: AnalysisSession, calls: InterpretationV8CallRecords | undefined): V8ExportSession {
  return {
    session_public_id: session.session_public_id,
    research_student_id: researchStudentId(session.user.user_id),
    assessment_public_id: session.assessment.assessment_public_id,
    attempt_number: session.attempt_number,
    family_attempt_number: familyAttemptIdentity.get(session)?.family_attempt_number ?? null,
    items: session.concept_unit_sessions.flatMap((unit) => unit.item_responses.map((response) => ({
      item_public_id: response.item.item_public_id,
      item_snapshot_public_id: itemSnapshotId(response),
      item_version: response.item_version_snapshot,
      item_order: response.item.item_order
    }))),
    profiles: session.concept_unit_sessions.flatMap((unit) => unit.student_profiles.map((profile) => ({
      profile_record_id: profileRecordIdentity(profile.id),
      concept_unit_public_id: unit.concept_unit.concept_unit_public_id,
      created_at: profile.created_at,
      item_level_evidence: profile.item_level_evidence,
      source_agent_call_public_id: profile.based_on_agent_call?.agent_call_public_id ?? null
    }))),
    profiling_calls: calls?.profiling_calls ?? [],
    conversations: session.formative_conversation_sessions.map((conversation) => ({
      conversation_public_id: conversation.conversation_public_id,
      initial_item_level_evidence: conversation.initial_student_profile?.item_level_evidence ?? null
    })),
    tutor_turns: session.formative_conversation_sessions.flatMap((conversation) => conversation.conversation_turns.flatMap((turn) => {
      const telemetry = turn.formative_conversation_turn_telemetry;
      return turn.actor_type === "agent" && telemetry?.agent_call
        ? [{
            conversation_public_id: conversation.conversation_public_id,
            agent_call_public_id: telemetry.agent_call.agent_call_public_id,
            turn_sequence_index: turn.sequence_index,
            conversation_local_turn_sequence_index: telemetry.conversation_local_turn_sequence_index ?? null,
            created_at: turn.created_at
          }]
        : [];
    })),
    feedback_calls: calls?.feedback_calls ?? [],
    review_signals: calls?.review_signals ?? []
  };
}

function sessionExportFiles(source: ExportSourceIdentity, sessions: AnalysisSession[],
  supplemental: SupplementalRecords, includeRestricted: boolean,
  v8: InterpretationV8Context = { decisions: new Map(), calls: new Map() }) {
  // Interpretation v8 files, merged across the chunk's sessions (each file keeps one header).
  const v8Files = new Map<string, { path: string; data: string }>();
  for (const session of sessions) {
    for (const file of interpretationV8SessionFiles(
      interpretationV8ExportSession(session, v8.calls.get(session.session_public_id)), v8.decisions, includeRestricted)) {
      const existing = v8Files.get(file.path);
      v8Files.set(file.path, existing && file.path.endsWith(".csv")
        ? { path: file.path, data: existing.data + file.data.slice(file.data.indexOf("\n") + 1) }
        : existing ?? file);
    }
  }
  return [
    ...responseStageExportFiles(sessions.map(session => ({
      session_public_id: session.session_public_id, assessment_public_id: session.assessment.assessment_public_id,
      research_student_id: researchStudentId(session.user.user_id), attempt_number: session.attempt_number,
      events: session.process_events.map(event => ({ ...event, item_public_id: event.item?.item_public_id ?? null })),
      items: session.concept_unit_sessions.flatMap(c => c.item_responses.map(response => ({
        item_public_id: response.item.item_public_id, item_snapshot_public_id: itemSnapshotId(response), item_version: response.item_version_snapshot
      }))),
      turns: session.conversation_turns.map(turn => ({ ...turn, item_public_id: turn.item?.item_public_id ?? null }))
    }))),
    {
      path: "sessions.csv",
      data: csv(SESSIONS_COLUMNS, sessionRows(source, sessions, supplemental, v8.decisions))
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
      data: csv(AGENT_ACTIVITY_RECORDS_COLUMNS, agentAndActivityRows(sessions, supplemental, v8.decisions))
    },
    {
      path: "profile_item_evidence.csv",
      data: csv([
        "session_public_id", "concept_unit_public_id", ...PROFILE_PROVENANCE_COLUMNS,
        "item_public_id", "reasoning_quality", "confidence_rating", "created_at"
      ], sessions.flatMap((session) => session.concept_unit_sessions.flatMap((concept) =>
        concept.student_profiles.flatMap((profile) => profileItemEvidence(profile).map((evidence) => ({
          session_public_id: session.session_public_id,
          concept_unit_public_id: concept.concept_unit.concept_unit_public_id,
          ...profileRecordProvenance(profile), ...evidence, created_at: iso(profile.created_at)
        })))
      )))
    },
    {
      path: "profile_data_dictionary.csv",
      data: csv(["variable", "definition"], Object.entries(PROFILE_FIELD_DEFINITIONS)
        .map(([variable, definition]) => ({ variable, definition })))
    },
    ...v8Files.values(),
    {
      path: "pause_episodes.csv",
      data: csv(["session_public_id", "research_student_id", ...Object.keys(PAUSE_EPISODE_DEFINITIONS)], sessions.flatMap(session =>
        derivePauseEpisodes(session.process_events, session.formative_conversation_sessions.map(conversation => ({ ...conversation,
          concept_unit_public_id: conversation.concept_unit_session.concept_unit.concept_unit_public_id
        })), session.completed_at).map(episode => ({ session_public_id: session.session_public_id,
          research_student_id: researchStudentId(session.user.user_id), ...episode }))))
    },
    {
      path: "pause_episode_data_dictionary.csv",
      data: csv(["variable", "definition"], Object.entries({ session_public_id: "Public session join key.",
        research_student_id: "Pseudonymous student join key; not username.", ...PAUSE_EPISODE_DEFINITIONS }).map(([variable, definition]) => ({ variable, definition })))
    },
    {
      path: "formative_conversation_sessions.csv",
      data: csv(
        FORMATIVE_CONVERSATION_SESSION_COLUMNS,
        formativeConversationSessionRows(sessions, v8.decisions)
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
      data: csv(ASSESSMENT_SUMMARY_COLUMNS, assessmentSummaryRows(source, sessions, supplemental, v8.decisions))
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
}

async function generateAnalysisReadyFiles(input: AnalysisReadyExportInput, spool: ResearchExportSpool) {
  const auditAssessmentIds: string[] = [];
  try { assertResearchPseudonymizationReadyForExport(); } catch (error) {
    if (error instanceof ResearchPseudonymizationConfigError) {
      throw new ContentServiceError(error.code, error.message, 503, {
        retryable: true,
        operator_action: "Run research-export:preflight and configure the server-side research pseudonymization key."
      });
    }
    throw error;
  }
  const includeStudyCodes = requestedStudyCodes(input.include_study_codes);
  const source = sourceFor(input);
  const includeRestricted = input.include_restricted_fields === true;
  const emit = async (file: { path: string; data: string }) => {
    assertAnalysisReadySafety([file], includeRestricted);
    await spool.append(file);
  };
  const attemptObservations: ReturnType<typeof observeAttempts> = [];
  // The same attempts with their conversation turn counts, for student_participation_summary.csv.
  const participationAttempts: ParticipationAttempt[] = [];
  const familyAttemptNumbers = new Map<string, number>();
  // Instructor item decisions (interpretation v8), loaded once per mini-test in scope.
  const decisionRecordsByAssessment = new Map<string, ItemReviewDecisionRecord[]>();
  const instructorPseudonym = {
    instructor: (userId: string) => researchInstructorId(userId),
    version: researchPseudonymizationMetadata().research_pseudonym_version
  };
  // A single snapshot, but only one session's full event/profile graph in memory.
  // Files stay private until the transaction and every integrity check succeed.
  const { snapshotAt, study } = await prisma.$transaction(async (tx) => {
    const [snapshot] = await tx.$queryRaw<Array<{ snapshot_at: Date }>>`SELECT transaction_timestamp() AS snapshot_at`;
    // Students and mini-tests in scope; the participant filter (study codes) is resolved here.
    const studyScope = await loadStudyScope(tx, {
      teacher_user_db_id: input.teacher_user_db_id,
      scope: input.scope,
      assessment_public_id: input.assessment_public_id,
      student_user_id: input.student_user_id,
      scope_session_where: sessionWhere(input),
      authorized_session_where: { user: { role: "student" }, OR: authorizedSessionOr(input.teacher_user_db_id) },
      include_study_codes: includeStudyCodes
    });
    if (includeStudyCodes && !studyScope.students.length) throw new ContentServiceError("no_matching_study_codes",
      `None of the ${includeStudyCodes.length} study codes matches a student in this export scope.`, 409,
      { requested_count: includeStudyCodes.length });
    // Every session-based file is built from sessions loaded with this filter, so none can include another student.
    const scoped: SessionScope = includeStudyCodes ? { ...input, student_user_ids: studyScope.students.map((student) => student.user_id) } : input;
    const references = await tx.assessmentSession.findMany({
      where: sessionWhere(scoped),
      orderBy: [{ assessment: { title: "asc" } }, { user: { user_id: "asc" } },
        { attempt_number: "asc" }, { created_at: "asc" }, { id: "asc" }],
      select: { session_public_id: true }
    });
    if (!references.length) throw new ContentServiceError("no_session_data",
      "No student sessions are available for this export scope.", 409);
    for (const reference of references) {
      const sessions = await loadSessions({ ...scoped, session_public_id: reference.session_public_id }, tx);
      for (const session of sessions) {
        familyAttemptNumbers.set(session.session_public_id, (await resolveFamilyAttemptIdentity(tx, session)).family_attempt_number);
      }
      const supplemental = await loadSupplementalRecords([reference.session_public_id], tx);
      const chances = await tx.assessmentAttemptChance.findMany({
        where: { session_public_id: reference.session_public_id },
        select: { session_public_id: true, policy_version: true, waived_at: true }
      });
      const observations = observeAttempts(sessions, chances);
      attemptObservations.push(...observations);
      participationAttempts.push(...sessions.map((session, index) => ({
        attempt: observations[index],
        conversations: session.formative_conversation_sessions.map((conversation) => ({
          student_turns: conversation.conversation_turns.filter((turn) => turn.actor_type === "student").length,
          tutor_turns: conversation.conversation_turns.filter((turn) => turn.actor_type === "agent").length
        }))
      })));
      const v8Calls = new Map<string, InterpretationV8CallRecords>();
      for (const session of sessions) {
        v8Calls.set(session.session_public_id, await loadInterpretationV8CallRecords(tx, session.id));
        const assessmentPublicId = session.assessment.assessment_public_id;
        if (!decisionRecordsByAssessment.has(assessmentPublicId)) {
          decisionRecordsByAssessment.set(assessmentPublicId, await loadItemReviewDecisionRecords(tx, assessmentPublicId, instructorPseudonym));
        }
      }
      const decisions = currentItemDecisions(sessions.flatMap((session) =>
        decisionRecordsByAssessment.get(session.assessment.assessment_public_id) ?? []));
      for (const file of sessionExportFiles(source, sessions, supplemental, includeRestricted, { decisions, calls: v8Calls })) await emit(file);
      if (includeRestricted) {
        // R3: researcher-only AI audit rows (never in the default export).
        for (const session of sessions) {
          auditAssessmentIds.push(session.assessment.assessment_public_id);
          await emit({ path: AI_CALL_AUDIT_FILE, data: csv(AI_CALL_AUDIT_COLUMNS, await sessionAiCallAuditRows(tx, {
            session_db_id: session.id,
            session_public_id: session.session_public_id,
            research_student_id: researchStudentId(session.user.user_id),
            assessment_public_id: session.assessment.assessment_public_id,
            attempt_number: session.attempt_number
          })) });
        }
      }
      if (input.scope === "selected_session") await emit({
        path: "session_diagnostic_manifest.json", data: sessionDiagnosticManifest(source, sessions, supplemental)
      });
    }
    // One item_review_decisions.csv for every mini-test in scope (current and superseded decisions).
    for (const records of decisionRecordsByAssessment.values()) await emit(itemReviewDecisionFile(records));
    // Instructor reports summarise a whole class, so they are exported only for
    // whole-cohort scopes that include incomplete attempts (the report's own rule),
    // and never with a participant filter: their inputs cover students outside the list.
    if (includeRestricted && auditAssessmentIds.length && !includeStudyCodes &&
        (input.scope === "all_authorized" || input.scope === "selected_assessment") &&
        input.include_incomplete_sessions !== false) {
      await emit({ path: AI_CALL_AUDIT_FILE, data: csv(AI_CALL_AUDIT_COLUMNS, await instructorReportAuditRows(tx, auditAssessmentIds)) });
    }
    // Study-design files: catalog (complete for the scope), roster and summary (filtered students).
    const catalog = miniTestCatalog({ assessments: studyScope.assessments, in_scope: studyScope.in_scope,
      snapshot_at: snapshot.snapshot_at, instructor: instructorPseudonym.instructor });
    await emit({ path: "mini_test_catalog.csv", data: csv(MINI_TEST_CATALOG_COLUMNS, catalog.rows) });
    await emit({ path: "student_roster.csv", data: csv(STUDENT_ROSTER_COLUMNS, studentRosterRows({
      students: studyScope.students, shared_codes: sharedStudyCodes(studyScope.candidates), teacher_user_db_id: input.teacher_user_db_id,
      attempts: participationAttempts, instructor: instructorPseudonym.instructor, pseudonym_version: instructorPseudonym.version
    })) });
    await emit({ path: "student_participation_summary.csv", data: csv(columnsFor(STUDENT_PARTICIPATION_SUMMARY_COLUMNS, includeRestricted),
      studentParticipationSummaryRows({ students: studyScope.students, attempts: participationAttempts, catalog, include_restricted: includeRestricted })) });
    if (includeRestricted) {
      await emit({ path: "summative_outcomes.csv", data: csv(SUMMATIVE_OUTCOMES_COLUMNS,
        summativeOutcomeRows(await loadSummativeOutcomeRecords(tx, studyScope.students), studyScope.students)) });
    }
    return { snapshotAt: snapshot.snapshot_at.toISOString(), study: studyScope };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: includeRestricted ? 300_000 : 120_000 });
  if (includeRestricted) {
    await emit({ path: AI_CALL_AUDIT_DICTIONARY_FILE, data: csv(["variable", "definition"],
      Object.entries(AI_CALL_AUDIT_DEFINITIONS).map(([variable, definition]) => ({ variable, definition }))) });
  }
  // Comparisons retain compact sealed-attempt evidence, not all process logs.
  for (const file of attemptComparisonExportFiles({ attempts: attemptObservations, snapshot_at: snapshotAt,
    pseudonym: researchStudentId, include_restricted: includeRestricted, scope: input.scope,
    family_attempt_numbers: familyAttemptNumbers })) await emit(file);
  for (const file of researchStudyTemplateFiles({ attempts: attemptObservations, snapshot_at: snapshotAt,
    pseudonym: researchStudentId, roster: study.students })) await emit(file);
  await spool.finishCoverage();
  await emit({ path: "README.txt", data: [
    "Research dataset v2",
    "Start with data_coverage.csv and its notes to inspect actual populated/blank/zero values by dataset, actor and stage; population is not proof of measurement validity.",
    "Profile projection v3: profile_provenance_eligible is the preferred technical provenance filter; profile_valid_for_learning_analysis is its compatibility alias. Neither is independent scientific validation. Intermediate processing artifacts and fallback records are retained, not counted as repeated learning measurements.",
    "profile_item_evidence.csv preserves per-item model judgments from canonical and legacy schemas with profile_record_id and provenance. It does not repeat raw student reasoning. Legacy aggregate categories remain on their original agent_activity_records profile rows; blank current aggregate categories are not inferred or copied from earlier profiles.",
    "profile_reassessment_status distinguishes a validated reassessment from not reassessed or incomplete reassessment. A paused/ended conversation alone is not a learning outcome. See profile_data_dictionary.csv.",
    "Join session_public_id to sessions.csv. Join item snapshots using both assessment_snapshot_public_id and item_snapshot_public_id.",
    "event_public_id is stable across exports; event_sequence_index is export ordering, not a permanent identity.",
    "Empty CSV cells denote unavailable or inapplicable values, not measured zero or false. Formula-leading text is prefixed with an apostrophe for spreadsheet safety.",
    "CSV contract research-csv-v2: Boolean values are true/false in every data table; null/undefined are empty. Historical supplementary archives encoded false as empty: re-export rather than converting every old blank to false.",
    "data_coverage.csv distinguishes current collection_status from observed population; retained uncollected interval fields stay blank. Consult research_study_notes.txt for unfilled cohort, independent human review and external outcome worksheets. Templates are not observed research data.",
    "Session timing v4 ends open attempts at the latest server-recorded process or conversation activity; completion remains the cutoff for closed attempts. Paused lifecycle windows are excluded from resumable time. Visible time is not attention or active learning. Item timing retains its own contract version.",
    "pause_episodes.csv separates explicit assessment and conversation-only pauses, links matching resumes and available display/message context. Missing returns are censored at export, not withdrawal. Pauses do not measure dissatisfaction. See pause_episode_data_dictionary.csv.",
    "Raw duration_ms on typing summaries is elapsed input time, not active typing. Unmeasured active interaction remains empty.",
    "Browser events are best effort: delivery gaps, absent visibility, multiple documents, and unrecovered browser closure limit inference. Absence is not nonoccurrence.",
    "No consent or withdrawal decision is inferred. Apply the approved study cohort before analysis. Free text may contain identifying information and requires review.",
    includeStudyCodes
      ? "Participant filter (participant_filter in the manifest): this export keeps only students whose study code was on the include list (consenting participants); every student-level and attempt-level file, including restricted audit files, was built from those students only, and mini_test_catalog.csv stays complete. A listed code shared by two students (student_roster.study_code_shared) includes both. Instructor-report audit rows are omitted because their inputs cover the whole class. The list itself is not stored; list_sha256 identifies it."
      : "Participant filter: none (participant_filter.mode none in the manifest). Every student in scope is included; apply the consent list (study codes) before analysis, or export again with an include list.",
    "Incomplete attempts: include_incomplete_sessions false drops only attempts that were never submitted. A submitted attempt (sealed initial response package, sessions.initial_package_sealed true) is always included, whether or not the student chose Finish.",
    ...STUDY_PARTICIPATION_README_LINES,
    `Interpretation v8 (${INTERPRETATION_V8_EXPORT_VERSION}): interpretation_item_ratings.csv (one row per student, attempt and item), interpretation_claims.csv (possible misconceptions and ideas considered), interpretation_summaries.csv (stored label and the label with the instructor's current item decisions, counts, attempt role and feedback seen before the attempt), feedback_turn_records.csv (focus, strategy, student evidence and instructor-review flag of each opening and reply) and item_review_decisions.csv. Rules, rating definitions and boundaries are in ${INTERPRETATION_V8_NOTES_FILE}; every column is in research_data_dictionary.csv. Restricted exports add interpretation_process_audit.csv (process indicators sent to the profiling model and its process interpretations; audit only, never shown to instructors or students) and the answer_correct column.`,
    "Legacy profile columns (ability, engagement, integrated profile, evidence sufficiency, confidence alignment, misconception catalog counts, item-evidence format) are blank for interpretation v8 profiles in sessions.csv, assessment_summary.csv, agent_activity_records.csv and formative_conversation_sessions.csv, and so are the conversation-update and profile-transition columns (a v8 conversation never updates the profile); read interpretation_summary_label and the v8 files instead. profile_item_evidence.csv has no rows for v8 profiles. Earlier profiles and conversations are unchanged.",
    "Item administration v4 records collection decisions, not quality: see the item_admin_v4_* columns in item_responses.csv; insufficient-knowledge judgments are never recorded for v4 replies.",
    "Restricted exports only: ai_call_audit.csv lists every model call recorded for the exported attempts, plus instructor reports for whole-class scopes (inputs, raw output including rejected drafts, validated output, model, effort, prompt version and hash) for AI-output review; see ai_call_audit_data_dictionary.csv. Students never see this file.",
    "Correct answers and teacher-only fields are included only when restricted_fields_included is true in the manifest.",
    "The manifest lists every other ZIP entry. SHA-256 values cover UTF-8 entry bytes; the manifest excludes its own hash to avoid recursion."
  ].join("\n") + "\n" });
  const manifest = {
    schema_version: "research-dataset-manifest-v1",
    generation_policy_version: "session-spooled-export-v1",
    export_schema_version: ANALYSIS_READY_EXPORT_VERSION,
    csv_contract_version: RESEARCH_CSV_CONTRACT_VERSION,
    boolean_encoding: "true_false_empty_for_missing",
    measurement_availability_version: MEASUREMENT_AVAILABILITY_VERSION,
    study_template_version: STUDY_TEMPLATE_VERSION,
    response_evidence_version: RESPONSE_EVIDENCE_VERSION,
    profile_projection_version: PROFILE_PROJECTION_VERSION,
    interpretation_v8_export_version: INTERPRETATION_V8_EXPORT_VERSION,
    study_participation_export_version: STUDY_PARTICIPATION_EXPORT_VERSION,
    export_run_public_id: source.export_run_public_id,
    export_generated_at: source.export_generated_at,
    app_commit_sha: source.app_commit_sha,
    database_snapshot_at: snapshotAt,
    isolation_level: "RepeatableRead",
    snapshot_policy: "Rows visible in one database transaction; late-arriving events appear in a later export.",
    scope: input.scope,
    include_incomplete_sessions: input.include_incomplete_sessions !== false,
    incomplete_sessions_rule: "Submitted attempts (sealed initial response package) are always included; include_incomplete_sessions decides only never-submitted attempts.",
    // Counts and a hash of the consent list; the study codes themselves are never stored.
    participant_filter: study.participant_filter,
    restricted_fields_included: includeRestricted,
    pseudonymization: {
      version: researchPseudonymizationMetadata().research_pseudonym_version,
      method: researchPseudonymizationMetadata().pseudonymization_method
    },
    timing_contract_version: TIMING_CONTRACT_VERSION,
    timing_source_version: TIMING_SOURCE_VERSION,
    timing_version_scope: "Legacy fallback constants only; use each row's timing_contract_version/timing_source_version. Browser item rows use timing-contract-v4 and response-stage-observation-v1; stage tables carry calculation_version.",
    session_timing_contract_version: SESSION_TIMING_CONTRACT_VERSION,
    // R3: restricted exports carry model inputs and outputs in ai_call_audit.csv.
    omitted_fields: includeRestricted ? ["raw_process_payloads", "provider_transport_metadata"] : ["raw_provider_payloads", "raw_process_payloads", ...restrictedDefaultColumns],
    entries: spool.manifestEntries()
  };

  await emit({ path: "research_manifest.json", data: JSON.stringify(manifest, null, 2) });
  const suffix =
    input.scope === "selected_assessment" && input.assessment_public_id
      ? `assessment_${input.assessment_public_id}`
      : input.scope === "selected_student" && source.selected_student_id
        ? `student_${privacySafeStudentArtifactSegment({
            source,
            stable_pseudonymous_student_id: source.selected_student_id
          })}`
        : input.scope === "selected_session" && input.session_public_id
          ? `session_${input.session_public_id}`
          : "all_authorized";

  return {
    filename: `${suffix}${includeStudyCodes ? "_participants" : ""}_research_dataset.zip`,
    content_type: "application/zip",
    source, row_counts: spool.rowCounts(),
    restricted_fields_included: includeRestricted, no_live_provider_call_made: true
  };
}

// Compatibility API for offline consumers and regression tests. HTTP routes must
// use the disk-backed writer below, never materialize the complete ZIP in memory.
export async function buildAnalysisReadyResearchDataBundle(input: AnalysisReadyExportInput) {
  const spool = await ResearchExportSpool.create(exportStorageDirectory());
  try {
    const result = await generateAnalysisReadyFiles(input, spool);
    const files = await spool.readAll();
    return { ...result, files, buffer: createStoreOnlyZip(files) };
  } finally { await spool.dispose(); }
}

export async function writeAnalysisReadyResearchDataBundle(input: AnalysisReadyExportInput, storageKey: string) {
  return withResearchExportSlot(async () => {
    const spool = await ResearchExportSpool.create(exportStorageDirectory());
    try {
      const result = await generateAnalysisReadyFiles(input, spool);
      await spool.publishZip(pathForStorageKey(storageKey));
      return result;
    } finally { await spool.dispose(); }
  });
}
