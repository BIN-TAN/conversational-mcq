import { createHash, randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { Prisma } from "@prisma/client";
import { runInitialStudentProfiling } from "@/lib/agents/student-profiling/service";
import { prisma } from "@/lib/db";
import { hashSecret } from "@/lib/password";
import { createResponsePackage } from "@/lib/services/response-packages";
import { generatePublicId } from "@/lib/services/ids";
import { normalizeUserId } from "@/lib/services/student-accounts/validation";
import {
  buildFormativeConversationRuntimeContextSeed
} from "@/lib/services/student-assessment/formative-conversation/runtime-context";
import {
  processFormativeConversationOpening,
  processFormativeConversationStudentMessage,
  type FormativeConversationAgentRunner
} from "@/lib/services/student-assessment/formative-conversation/runtime";
import { recordFormativeConversationLifecycleEvent } from "@/lib/services/student-assessment/formative-conversation/telemetry";
import { getTeacherReviewItemResponses } from "@/lib/services/teacher-review/item-responses";
import { getTeacherReviewSessionDetail } from "@/lib/services/teacher-review/session-detail";
import { buildAnalysisReadyResearchDataBundle } from "@/lib/services/teacher-research-data/analysis-ready-export";
import {
  SYNTHETIC_STUDENT_VALIDATION_VERSION,
  SyntheticResearchValidationReportSchema,
  type SyntheticResearchValidationReport,
  type SyntheticStudentPersona,
  type SyntheticValidationMode
} from "./contracts";

const REQUIRED_RESEARCH_FILES = [
  "item_responses.csv",
  "process_events.csv",
  "formative_conversation_sessions.csv",
  "formative_conversation_turns.csv",
  "formative_conversation_events.csv",
  "formative_conversation_llm_calls.csv",
  "formative_conversation_profile_transitions.csv",
  "formative_conversation_data_dictionary.csv"
] as const;

const SYNTHETIC_ASSESSMENT_ITEMS = [
  {
    item_order: 1,
    item_stem:
      "A test has a high internal-consistency coefficient. Which conclusion is best supported?",
    options: [
      {
        label: "A",
        text: "The scores are internally consistent, but validity still needs separate evidence."
      },
      {
        label: "B",
        text: "The high coefficient proves the scores are valid for every intended use."
      },
      {
        label: "C",
        text: "The coefficient proves every observed score is free from measurement error."
      }
    ],
    correct_option: "A",
    explanation:
      "Internal consistency concerns how coherently scores behave. It does not by itself establish evidence for a particular interpretation or use.",
    distractor_rationales: {
      B: "Conflates reliability evidence with validity evidence.",
      C: "Treats a group-level reliability coefficient as error-free individual measurement."
    },
    expected_reasoning_patterns: [
      "Distinguishes score consistency from evidence for an intended interpretation."
    ]
  },
  {
    item_order: 2,
    item_stem:
      "What does the standard error of measurement contribute when interpreting an observed score?",
    options: [
      {
        label: "A",
        text: "It describes expected measurement error around an observed score."
      },
      {
        label: "B",
        text: "It proves the observed score is the person's exact true score."
      },
      {
        label: "C",
        text: "It reports the percentage of items answered incorrectly."
      }
    ],
    correct_option: "A",
    explanation:
      "The standard error of measurement represents expected score uncertainty; it does not make an observed score exact.",
    distractor_rationales: {
      B: "Removes uncertainty rather than representing it.",
      C: "Confuses measurement error with an item-level error percentage."
    },
    expected_reasoning_patterns: [
      "Connects the standard error of measurement with uncertainty around observed scores."
    ]
  },
  {
    item_order: 3,
    item_stem:
      "Which statement best reflects a contemporary validity argument?",
    options: [
      {
        label: "A",
        text: "Evidence is evaluated for the intended interpretation and use of scores."
      },
      {
        label: "B",
        text: "Validity is automatically established whenever reliability is high."
      },
      {
        label: "C",
        text: "Validity is a permanent property of the test independent of context."
      }
    ],
    correct_option: "A",
    explanation:
      "Validity concerns the evidence supporting an intended score interpretation and use in context, not a context-free property of a test.",
    distractor_rationales: {
      B: "Treats reliability as sufficient validity evidence.",
      C: "Treats validity as detached from interpretation, use, and context."
    },
    expected_reasoning_patterns: [
      "Relates validity evidence to an intended interpretation and use."
    ]
  }
] as const;

type SyntheticFixture = {
  run_public_id: string;
  teacher_user_db_id: string;
  assessment_public_id: string;
  assessment_db_id: string;
  concept_unit_db_id: string;
  concept_unit_public_id: string;
  items: Array<{
    id: string;
    item_public_id: string;
    item_order: number;
    item_stem: string;
    options: Prisma.JsonValue;
    correct_option: string;
    version: number;
  }>;
};

type SyntheticStudentExecution = {
  persona: SyntheticStudentPersona;
  session_public_id: string;
  conversation_public_id: string;
  execution_error: string | null;
};

export type SyntheticResearchValidationRunOptions = {
  mode: Exclude<SyntheticValidationMode, "plan_only">;
  personas: readonly SyntheticStudentPersona[];
  runner_factory: () => FormativeConversationAgentRunner;
  run_public_id?: string;
};

export type SyntheticResearchValidationRunResult = {
  report: SyntheticResearchValidationReport;
  research_export: {
    filename: string;
    buffer: Buffer;
  };
};

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function reportRunPublicId() {
  return `synthetic_validation_${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}_${randomUUID().slice(0, 8)}`;
}

function addMilliseconds(date: Date, milliseconds: number) {
  return new Date(date.getTime() + milliseconds);
}

function csvRows(data: string) {
  return parse(data, {
    columns: true,
    skip_empty_lines: true
  }) as Array<Record<string, string>>;
}

function contiguousPositiveIndexes(values: number[]) {
  return (
    values.length === 0 ||
    values.every((value, index) => value === index + 1)
  );
}

function reproducibleCsvContent(data: string) {
  return csvRows(data).map((row) =>
    Object.fromEntries(
      Object.entries(row).filter(
        ([column]) =>
          ![
            "export_run_public_id",
            "export_generated_at",
            "derived_at"
          ].includes(column)
      )
    )
  );
}

function safeExecutionError() {
  return "synthetic_formative_conversation_execution_failed";
}

function estimatedLogicalCalls(personas: readonly SyntheticStudentPersona[]) {
  return personas.reduce(
    (total, persona) =>
      total + 1 + 1 + persona.conversation_behavior.length,
    0
  );
}

async function createSyntheticAssessmentFixture(input: {
  run_public_id: string;
  personas: readonly SyntheticStudentPersona[];
}) {
  const teacherUserId = `${input.run_public_id}_teacher`;
  const teacher = await prisma.user.create({
    data: {
      user_id: teacherUserId,
      user_id_normalized: normalizeUserId(teacherUserId),
      display_name: "Synthetic validation teacher",
      role: "teacher_researcher",
      password_hash: await hashSecret(`${input.run_public_id}_teacher_secret`)
    }
  });
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: generatePublicId("assessment"),
      title: `${input.run_public_id} synthetic validation assessment`,
      description:
        "Synthetic research validation fixture for the assessment-to-formative-conversation pipeline.",
      diagnostic_focus:
        "Distinguish reliability, measurement error, and validity evidence.",
      status: "published",
      workflow_mode: "manual_review",
      response_collection_mode: "deterministic",
      created_by_user_db_id: teacher.id
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: generatePublicId("concept_unit"),
      assessment_db_id: assessment.id,
      title: "Measurement evidence and score interpretation",
      learning_objective:
        "Explain how reliability, measurement error, and validity evidence support different claims about scores.",
      related_concept_description:
        "Measurement-theory distinctions used in score interpretation.",
      administration_rules: {
        no_feedback_during_initial_administration: true
      },
      order_index: 1,
      status: "published",
      version: 1
    }
  });
  const items = [];
  for (const definition of SYNTHETIC_ASSESSMENT_ITEMS) {
    items.push(
      await prisma.item.create({
        data: {
          item_public_id: generatePublicId("item"),
          concept_unit_db_id: conceptUnit.id,
          item_order: definition.item_order,
          item_stem: definition.item_stem,
          options: json(definition.options),
          correct_option: definition.correct_option,
          distractor_rationales: json(definition.distractor_rationales),
          expected_reasoning_patterns: json(
            definition.expected_reasoning_patterns
          ),
          possible_misconception_indicators: json(
            Object.values(definition.distractor_rationales)
          ),
          administration_rules: {
            no_feedback_during_initial_administration: true
          },
          included_in_published_set: true,
          status: "published",
          version: 1
        }
      })
    );
  }

  return {
    run_public_id: input.run_public_id,
    teacher_user_db_id: teacher.id,
    assessment_public_id: assessment.assessment_public_id,
    assessment_db_id: assessment.id,
    concept_unit_db_id: conceptUnit.id,
    concept_unit_public_id: conceptUnit.concept_unit_public_id,
    items
  } satisfies SyntheticFixture;
}

async function persistSyntheticAssessmentEvidence(input: {
  fixture: SyntheticFixture;
  persona: SyntheticStudentPersona;
  persona_index: number;
}) {
  const userId = `${input.fixture.run_public_id}_${input.persona.persona_id}`;
  const student = await prisma.user.create({
    data: {
      user_id: userId,
      user_id_normalized: normalizeUserId(userId),
      display_name: input.persona.display_name,
      role: "student",
      access_code_hash: await hashSecret(
        `${input.fixture.run_public_id}_${input.persona.persona_id}_secret`
      )
    }
  });
  const base = new Date(
    Date.now() -
      (input.fixture.items.length * 120_000 +
        (input.persona_index + 1) * 30_000)
  );
  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: generatePublicId("session"),
      user_db_id: student.id,
      assessment_db_id: input.fixture.assessment_db_id,
      attempt_number: 1,
      status: "active",
      current_phase: "profiling_pending",
      workflow_mode_snapshot: "manual_review",
      response_collection_mode_snapshot: "deterministic",
      current_concept_unit_db_id: input.fixture.concept_unit_db_id,
      started_at: base,
      last_activity_at: base
    }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: input.fixture.concept_unit_db_id,
      status: "initial_completed",
      initial_started_at: base,
      followup_status: "not_started",
      followup_round_count: 0
    }
  });

  let itemCursor = base;
  for (const behavior of input.persona.assessment_response_behavior) {
    const item = input.fixture.items.find(
      (entry) => entry.item_order === behavior.item_number
    );
    const definition = SYNTHETIC_ASSESSMENT_ITEMS.find(
      (entry) => entry.item_order === behavior.item_number
    );
    if (!item || !definition) {
      throw new Error("synthetic_assessment_item_missing");
    }
    const itemStartedAt = addMilliseconds(itemCursor, 2_000);
    const itemSubmittedAt = addMilliseconds(
      itemStartedAt,
      behavior.response_time_ms
    );
    const optionSelectedAt = addMilliseconds(
      itemStartedAt,
      behavior.time_to_first_action_ms
    );
    const reasoningAt = addMilliseconds(
      itemStartedAt,
      Math.max(
        behavior.time_to_first_action_ms + 500,
        Math.floor(behavior.response_time_ms * 0.62)
      )
    );
    const confidenceAt = addMilliseconds(
      itemStartedAt,
      Math.max(
        behavior.time_to_first_action_ms + 1_000,
        Math.floor(behavior.response_time_ms * 0.82)
      )
    );

    await prisma.itemResponse.create({
      data: {
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        selected_option: behavior.selected_option,
        correct_option_snapshot: item.correct_option,
        correctness:
          behavior.selected_option === item.correct_option
            ? "correct"
            : "incorrect",
        reasoning_text: behavior.reasoning_text,
        confidence_rating: behavior.confidence_rating,
        item_response_time_ms: behavior.response_time_ms,
        item_started_at: itemStartedAt,
        item_submitted_at: itemSubmittedAt,
        revision_count:
          behavior.prior_option_selections.length +
          behavior.reasoning_revision_count,
        answer_explanation_revealed: true,
        revealed_at: itemSubmittedAt,
        reveal_trigger: "initial_package_completed",
        explanation_version: "synthetic-validation-item-explanation-v1",
        student_display_acknowledged_at: itemSubmittedAt,
        item_version_snapshot: item.version,
        item_snapshot: json({
          item_public_id: item.item_public_id,
          item_stem: item.item_stem,
          options: item.options,
          correct_option: item.correct_option,
          expected_reasoning_patterns:
            definition.expected_reasoning_patterns,
          student_safe_answer_explanation: definition.explanation
        }),
        client_submission_id: `${input.fixture.run_public_id}:${input.persona.persona_id}:item:${behavior.item_number}`
      }
    });

    const events: Prisma.ProcessEventCreateManyInput[] = [
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        event_type: "item_presented",
        event_category: "initial_administration",
        event_source: "backend",
        payload: {
          item_public_id: item.item_public_id,
          item_position: behavior.item_number,
          initial_item_count: input.fixture.items.length
        },
        occurred_at: itemStartedAt
      }
    ];
    behavior.prior_option_selections.forEach((selectedOption, index) => {
      const occurredAt = addMilliseconds(
        optionSelectedAt,
        index * 250
      );
      events.push({
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        event_type: index === 0 ? "option_clicked" : "answer_changed",
        event_category: "initial_administration",
        event_source: "frontend",
        payload: {
          item_public_id: item.item_public_id,
          selected_option: selectedOption,
          revised: index > 0
        },
        occurred_at: occurredAt
      });
    });
    events.push(
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        event_type:
          behavior.prior_option_selections.length > 0
            ? "answer_changed"
            : "option_clicked",
        event_category: "initial_administration",
        event_source: "frontend",
        payload: {
          item_public_id: item.item_public_id,
          selected_option: behavior.selected_option,
          revised: behavior.prior_option_selections.length > 0,
          time_to_first_action_ms: behavior.time_to_first_action_ms
        },
        occurred_at: addMilliseconds(
          optionSelectedAt,
          behavior.prior_option_selections.length * 250
        )
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        event_type:
          behavior.reasoning_revision_count > 0
            ? "reasoning_revised"
            : "reasoning_submitted",
        event_category: "initial_administration",
        event_source: "frontend",
        payload: {
          item_public_id: item.item_public_id,
          reasoning_length: behavior.reasoning_text.length,
          revision_count: behavior.reasoning_revision_count
        },
        occurred_at: reasoningAt
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        event_type: "typing_activity_summary",
        event_category: "initial_administration",
        event_source: "frontend",
        payload: {
          item_public_id: item.item_public_id,
          field_type: "reasoning",
          duration_method: "elapsed_first_input_to_submit",
          duration_ms: Math.max(
            0,
            confidenceAt.getTime() - optionSelectedAt.getTime()
          ),
          edit_count: behavior.reasoning_revision_count
        },
        occurred_at: reasoningAt
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        event_type: "confidence_clicked",
        event_category: "initial_administration",
        event_source: "frontend",
        payload: {
          item_public_id: item.item_public_id,
          confidence_rating: behavior.confidence_rating
        },
        occurred_at: confidenceAt
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        event_type: "item_submitted",
        event_category: "initial_administration",
        event_source: "backend",
        payload: {
          item_public_id: item.item_public_id
        },
        occurred_at: itemSubmittedAt
      }
    );
    for (const observation of behavior.navigation_observations) {
      events.push({
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        event_type: observation.event_type,
        event_category: "initial_administration",
        event_source: "frontend",
        visibility_duration_ms:
          observation.event_type === "page_visible"
            ? observation.observed_interval_duration_ms ?? undefined
            : undefined,
        payload: {
          item_public_id: item.item_public_id,
          observable_only: true
        },
        occurred_at: addMilliseconds(
          itemStartedAt,
          observation.offset_ms
        )
      });
    }
    await prisma.processEvent.createMany({ data: events });
    itemCursor = addMilliseconds(itemSubmittedAt, 3_000);
  }

  const initialCompletedAt = addMilliseconds(itemCursor, 2_000);
  await prisma.processEvent.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      event_type: "package_submitted",
      event_category: "initial_administration",
      event_source: "backend",
      payload: {
        concept_unit_public_id: input.fixture.concept_unit_public_id
      },
      occurred_at: initialCompletedAt
    }
  });
  await prisma.conceptUnitSession.update({
    where: { id: conceptUnitSession.id },
    data: {
      initial_completed_at: initialCompletedAt
    }
  });
  await prisma.assessmentSession.update({
    where: { id: session.id },
    data: {
      last_activity_at: initialCompletedAt
    }
  });
  await createResponsePackage({
    concept_unit_session_db_id: conceptUnitSession.id,
    package_type: "initial_concept_unit_response_package",
    created_at: initialCompletedAt
  });

  return {
    student_user_db_id: student.id,
    session_public_id: session.session_public_id,
    concept_unit_session_db_id: conceptUnitSession.id
  };
}

async function runSyntheticStudent(input: {
  fixture: SyntheticFixture;
  persona: SyntheticStudentPersona;
  persona_index: number;
  mode: Exclude<SyntheticValidationMode, "plan_only">;
  runner_factory: () => FormativeConversationAgentRunner;
}) {
  const assessment = await persistSyntheticAssessmentEvidence(input);
  const profileResult = await runInitialStudentProfiling({
    concept_unit_session_db_id: assessment.concept_unit_session_db_id,
    invocation_reason: `${input.fixture.run_public_id}:${input.persona.persona_id}:initial_profile`
  });
  if (
    profileResult.status !== "profile_created" &&
    profileResult.status !== "already_profiled"
  ) {
    throw new Error("synthetic_initial_profile_not_created");
  }
  if (input.mode === "live_llm") {
    const initialProfile =
      await prisma.studentProfile.findFirstOrThrow({
        where: {
          concept_unit_session_db_id:
            assessment.concept_unit_session_db_id,
          profile_type: "initial"
        },
        orderBy: { created_at: "desc" },
        include: {
          based_on_agent_call: {
            select: {
              provider: true,
              live_call_allowed: true,
              call_status: true,
              output_validated: true
            }
          }
        }
      });
    if (
      initialProfile.based_on_agent_call?.provider !== "openai" ||
      !initialProfile.based_on_agent_call.live_call_allowed ||
      initialProfile.based_on_agent_call.call_status !== "succeeded" ||
      !initialProfile.based_on_agent_call.output_validated
    ) {
      throw new Error("synthetic_initial_profile_not_live_validated");
    }
  }
  const conversation =
    await prisma.formativeConversationSession.findUniqueOrThrow({
      where: {
        concept_unit_session_db_id:
          assessment.concept_unit_session_db_id
      }
    });
  const clientInstanceId = `${input.fixture.run_public_id}:${input.persona.persona_id}`;
  await recordFormativeConversationLifecycleEvent({
    conversation_public_id: conversation.conversation_public_id,
    client_event_id: `${clientInstanceId}:session_started`,
    event_type: "session_started",
    event_source: "backend",
    client_instance_id: clientInstanceId,
    occurred_at: new Date()
  });
  await recordFormativeConversationLifecycleEvent({
    conversation_public_id: conversation.conversation_public_id,
    client_event_id: `${clientInstanceId}:page_visible`,
    event_type: "page_visible",
    event_source: "frontend",
    client_instance_id: clientInstanceId,
    occurred_at: new Date()
  });

  let executionError: string | null = null;
  try {
    const openingContext =
      await buildFormativeConversationRuntimeContextSeed({
        conversation_public_id: conversation.conversation_public_id,
        student_user_db_id: assessment.student_user_db_id
      });
    await processFormativeConversationOpening(
      {
        conversation_public_id: conversation.conversation_public_id,
        context: openingContext
      },
      { runner_factory: input.runner_factory }
    );

    for (
      let turnIndex = 0;
      turnIndex < input.persona.conversation_behavior.length;
      turnIndex += 1
    ) {
      const behavior = input.persona.conversation_behavior[turnIndex];
      const submittedAt = new Date();
      const context = await buildFormativeConversationRuntimeContextSeed({
        conversation_public_id: conversation.conversation_public_id,
        student_user_db_id: assessment.student_user_db_id
      });
      await processFormativeConversationStudentMessage(
        {
          conversation_public_id: conversation.conversation_public_id,
          client_message_id: `${clientInstanceId}:message:${turnIndex + 1}`,
          message_text: behavior.message_text,
          context,
          observable_input_telemetry: {
            turn_started_at: addMilliseconds(
              submittedAt,
              -behavior.response_time_ms
            ),
            submitted_at: submittedAt,
            response_time_ms: behavior.response_time_ms,
            typing_started_at: addMilliseconds(
              submittedAt,
              -behavior.typing_duration_ms
            ),
            typing_ended_at: submittedAt,
            typing_duration_ms: behavior.typing_duration_ms,
            typing_duration_method: "active_intervals",
            edit_count: behavior.edit_count,
            backspace_count: behavior.backspace_count,
            paste_event_count: behavior.paste_event_count,
            paste_character_count: behavior.paste_character_count
          }
        },
        { runner_factory: input.runner_factory }
      );
    }
  } catch {
    executionError = safeExecutionError();
  }

  return {
    persona: input.persona,
    session_public_id: assessment.session_public_id,
    conversation_public_id: conversation.conversation_public_id,
    execution_error: executionError
  } satisfies SyntheticStudentExecution;
}

function validateResearchExport(input: {
  first: Awaited<ReturnType<typeof buildAnalysisReadyResearchDataBundle>>;
  second: Awaited<ReturnType<typeof buildAnalysisReadyResearchDataBundle>>;
}) {
  const issues: string[] = [];
  const file = (bundle: typeof input.first, path: string) =>
    bundle.files.find((entry) => entry.path === path)?.data ?? "";
  const requiredFilesPresent = REQUIRED_RESEARCH_FILES.every((path) =>
    Boolean(file(input.first, path))
  );
  if (!requiredFilesPresent) {
    issues.push("required_file_missing");
  }

  const turnRows = csvRows(
    file(input.first, "formative_conversation_turns.csv")
  );
  const eventRows = csvRows(
    file(input.first, "formative_conversation_events.csv")
  );
  const llmRows = csvRows(
    file(input.first, "formative_conversation_llm_calls.csv")
  );
  const transitionRows = csvRows(
    file(
      input.first,
      "formative_conversation_profile_transitions.csv"
    )
  );
  const rowsByConversation = (
    rows: Array<Record<string, string>>,
    sequenceField: string
  ) => {
    const grouped = new Map<string, number[]>();
    for (const row of rows) {
      const conversationId = row.conversation_public_id ?? "";
      const values = grouped.get(conversationId) ?? [];
      values.push(Number(row[sequenceField]));
      grouped.set(conversationId, values);
    }
    return [...grouped.values()].every((values) =>
      contiguousPositiveIndexes(values)
    );
  };
  const timelineReconstructable =
    rowsByConversation(
      turnRows,
      "conversation_local_turn_sequence_index"
    ) &&
    rowsByConversation(
      eventRows,
      "conversation_local_event_sequence_index"
    ) &&
    turnRows.every(
      (row) =>
        row.created_at.length > 0 &&
        Number.isFinite(Number(row.turn_sequence_index))
    );
  if (!timelineReconstructable) {
    issues.push("timeline_not_reconstructable");
  }

  const exportedAgentCallIds = new Set(
    llmRows
      .map((row) => row.agent_call_public_id)
      .filter(Boolean)
  );
  const agentCallJoinsValid = turnRows
    .filter((row) => row.actor_type === "agent")
    .every(
      (row) =>
        Boolean(row.agent_call_public_id) &&
        exportedAgentCallIds.has(row.agent_call_public_id)
    );
  if (!agentCallJoinsValid) {
    issues.push("agent_call_join_invalid");
  }

  const profileProvenanceValid = transitionRows.every(
    (row) =>
      Boolean(row.transition_public_id) &&
      Boolean(row.prior_profile_created_at) &&
      Boolean(row.updated_profile_created_at) &&
      Boolean(row.supporting_turn_sequence_indexes) &&
      Boolean(row.evidence_reference_public_ids) &&
      Boolean(row.source_agent_call_public_id) &&
      exportedAgentCallIds.has(row.source_agent_call_public_id)
  );
  if (!profileProvenanceValid) {
    issues.push("profile_provenance_invalid");
  }

  const reproducible = REQUIRED_RESEARCH_FILES.every(
    (path) =>
      JSON.stringify(
        reproducibleCsvContent(file(input.first, path))
      ) ===
      JSON.stringify(
        reproducibleCsvContent(file(input.second, path))
      )
  );
  if (!reproducible) {
    issues.push("export_not_reproducible");
  }

  return {
    status:
      issues.length === 0 ? ("passed" as const) : ("failed" as const),
    required_files_present: requiredFilesPresent,
    timeline_reconstructable: timelineReconstructable,
    agent_call_joins_valid: agentCallJoinsValid,
    profile_provenance_valid: profileProvenanceValid,
    reproducible,
    file_row_counts: input.first.row_counts,
    issue_codes: issues
  };
}

async function buildStudentReport(execution: SyntheticStudentExecution) {
  const [teacherDetail, itemResponses, conversation] = await Promise.all([
    getTeacherReviewSessionDetail(execution.session_public_id),
    getTeacherReviewItemResponses(execution.session_public_id),
    prisma.formativeConversationSession.findUniqueOrThrow({
      where: {
        conversation_public_id: execution.conversation_public_id
      },
      include: {
        conversation_turns: {
          orderBy: { sequence_index: "asc" }
        },
        agent_calls: {
          orderBy: { created_at: "asc" },
          select: {
            agent_call_public_id: true,
            call_status: true,
            input_tokens: true,
            output_tokens: true
          }
        },
        lifecycle_events: true,
        turn_telemetry: true,
        input_telemetry: true,
        profile_transitions: {
          orderBy: { transitioned_at: "desc" },
          take: 1,
          include: {
            source_agent_call: {
              select: {
                agent_call_public_id: true
              }
            },
            supporting_turn_references: true,
            _count: {
              select: {
                profile_evidence_references: true
              }
            }
          }
        }
      }
    })
  ]);
  const teacherConversation = teacherDetail.formative_conversations.find(
    (entry) =>
      entry.conversation_public_id === execution.conversation_public_id
  );
  if (!teacherConversation) {
    throw new Error("synthetic_teacher_trajectory_missing");
  }
  const latestTransition = conversation.profile_transitions[0] ?? null;
  const totalResponseTimeMs = conversation.turn_telemetry.reduce(
    (total, entry) => total + (entry.response_time_ms ?? 0),
    0
  );
  const totalTypingDurationMs = conversation.input_telemetry.reduce(
    (total, entry) => total + (entry.typing_duration_ms ?? 0),
    0
  );
  const totalInputTokens = conversation.agent_calls.reduce(
    (total, entry) => total + (entry.input_tokens ?? 0),
    0
  );
  const totalOutputTokens = conversation.agent_calls.reduce(
    (total, entry) => total + (entry.output_tokens ?? 0),
    0
  );

  return {
    persona_id: execution.persona.persona_id,
    session_public_id: execution.session_public_id,
    conversation_public_id: execution.conversation_public_id,
    initial_profile: teacherConversation.initial_learning_profile,
    conversation_length: {
      total_turns: conversation.conversation_turns.length,
      student_turns: conversation.conversation_turns.filter(
        (turn) => turn.actor_type === "student"
      ).length,
      tutor_turns: conversation.conversation_turns.filter(
        (turn) => turn.actor_type === "agent"
      ).length
    },
    agent_calls: {
      total: conversation.agent_calls.length,
      succeeded: conversation.agent_calls.filter(
        (call) => call.call_status === "succeeded"
      ).length,
      failed: conversation.agent_calls.filter(
        (call) => call.call_status !== "succeeded"
      ).length,
      public_ids: conversation.agent_calls.map(
        (call) => call.agent_call_public_id
      )
    },
    telemetry_summary: {
      lifecycle_event_count: conversation.lifecycle_events.length,
      turn_telemetry_count: conversation.turn_telemetry.length,
      input_telemetry_count: conversation.input_telemetry.length,
      total_response_time_ms: totalResponseTimeMs,
      total_typing_duration_ms: totalTypingDurationMs,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens
    },
    final_profile_transition:
      teacherConversation.profile_evolution.at(-1) ?? null,
    transition_evidence: {
      supporting_turn_count:
        latestTransition?.supporting_turn_references.length ?? 0,
      evidence_reference_count:
        latestTransition?._count.profile_evidence_references ?? 0,
      source_agent_call_public_id:
        latestTransition?.source_agent_call?.agent_call_public_id ?? null
    },
    teacher_trajectory: {
      starting_evidence: itemResponses.concept_units.flatMap(
        (conceptUnit) =>
          conceptUnit.item_responses.map((response) => ({
            item_public_id: response.item_public_id,
            correctness: response.correctness,
            reasoning_text: response.reasoning_text,
            confidence_rating: response.confidence_rating,
            item_response_time_ms: response.item_response_time_ms,
            revision_count: response.revision_count
          }))
      ),
      learning_conversation: teacherConversation.timeline,
      validated_change:
        teacherConversation.profile_evolution.at(-1) ?? null,
      current_learning_profile:
        teacherConversation.current_learning_profile,
      learning_outcome: teacherConversation.learning_outcome
    },
    execution_error: execution.execution_error
  };
}

export function buildSyntheticStudentValidationPlan(
  personas: readonly SyntheticStudentPersona[]
) {
  return {
    validation_version: SYNTHETIC_STUDENT_VALIDATION_VERSION,
    mode: "plan_only" as const,
    persona_count: personas.length,
    estimated_logical_generation_calls: estimatedLogicalCalls(personas),
    provider_calls_authorized: false,
    personas: personas.map((persona) => ({
      persona_id: persona.persona_id,
      display_name: persona.display_name,
      assessment_response_count:
        persona.assessment_response_behavior.length,
      conversation_turn_count: persona.conversation_behavior.length,
      conversation_intents: persona.conversation_behavior.map(
        (turn) => turn.intent
      )
    })),
    safeguards: {
      expected_learning_outcomes_absent: true,
      fixed_tutor_responses_absent: true,
      deterministic_activity_routing_absent: true
    }
  };
}

export async function runSyntheticStudentResearchValidation(
  options: SyntheticResearchValidationRunOptions
): Promise<SyntheticResearchValidationRunResult> {
  if (options.personas.length === 0) {
    throw new Error("synthetic_persona_selection_empty");
  }
  const runPublicId = options.run_public_id ?? reportRunPublicId();
  const fixture = await createSyntheticAssessmentFixture({
    run_public_id: runPublicId,
    personas: options.personas
  });
  const executions: SyntheticStudentExecution[] = [];
  for (let index = 0; index < options.personas.length; index += 1) {
    executions.push(
      await runSyntheticStudent({
        fixture,
        persona: options.personas[index],
        persona_index: index,
        mode: options.mode,
        runner_factory: options.runner_factory
      })
    );
  }

  const firstExport = await buildAnalysisReadyResearchDataBundle({
    teacher_user_db_id: fixture.teacher_user_db_id,
    scope: "selected_assessment",
    assessment_public_id: fixture.assessment_public_id,
    include_incomplete_sessions: true
  });
  const secondExport = await buildAnalysisReadyResearchDataBundle({
    teacher_user_db_id: fixture.teacher_user_db_id,
    scope: "selected_assessment",
    assessment_public_id: fixture.assessment_public_id,
    include_incomplete_sessions: true
  });
  const students = [];
  for (const execution of executions) {
    students.push(await buildStudentReport(execution));
  }
  const liveFormativeCalls =
    options.mode === "live_llm"
      ? await prisma.agentCall.findMany({
          where: {
            assessment_session: {
              assessment_db_id: fixture.assessment_db_id
            },
            agent_name: "formative_conversation_agent"
          },
          select: {
            provider: true,
            live_call_allowed: true,
            call_status: true,
            output_validated: true
          }
        })
      : [];
  const expectedFormativeCallCount = options.personas.reduce(
    (total, persona) =>
      total + 1 + persona.conversation_behavior.length,
    0
  );
  const liveFormativeExecutionValid =
    options.mode !== "live_llm" ||
    (liveFormativeCalls.length === expectedFormativeCallCount &&
      liveFormativeCalls.every(
        (call) =>
          call.provider === "openai" &&
          call.live_call_allowed &&
          call.call_status === "succeeded" &&
          call.output_validated
      ));
  const report = SyntheticResearchValidationReportSchema.parse({
    report_version: SYNTHETIC_STUDENT_VALIDATION_VERSION,
    run_public_id: runPublicId,
    mode: options.mode,
    generated_at: new Date().toISOString(),
    pedagogical_evaluation_valid:
      options.mode === "live_llm" &&
      executions.every((execution) => execution.execution_error === null) &&
      liveFormativeExecutionValid,
    provider_calls_authorized: options.mode === "live_llm",
    persona_count: options.personas.length,
    estimated_logical_generation_calls: estimatedLogicalCalls(
      options.personas
    ),
    students,
    export_validation: validateResearchExport({
      first: firstExport,
      second: secondExport
    }),
    safeguards: {
      expected_learning_outcomes_absent: true,
      fixed_tutor_responses_absent: true,
      deterministic_activity_routing_absent: true,
      raw_provider_payloads_excluded: true
    },
    limitations:
      options.mode === "live_llm"
        ? [
            "Synthetic student messages are scripted observations and do not adapt semantically to each tutor response.",
            "A single run is a pipeline validation, not evidence of psychometric validity or instructional effectiveness.",
            "A null final profile transition means the agent did not recommend a validated transition from the observed conversation."
          ]
        : [
            "Contract-test output validates persistence and export mechanics only; it is not a pedagogical evaluation.",
            "The no-provider runner and mock initial profile are test infrastructure and must not be interpreted as student outcomes.",
            "Synthetic student messages are scripted observations and do not adapt semantically to each tutor response."
          ]
  });

  return {
    report,
    research_export: {
      filename: firstExport.filename,
      buffer: firstExport.buffer
    }
  };
}

export async function cleanupSyntheticStudentValidationRun(
  runPublicId: string
) {
  const assessments = await prisma.assessment.findMany({
    where: {
      title: `${runPublicId} synthetic validation assessment`
    },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);
  if (assessmentIds.length === 0) {
    return;
  }
  const sessions = await prisma.assessmentSession.findMany({
    where: { assessment_db_id: { in: assessmentIds } },
    select: { id: true }
  });
  const sessionIds = sessions.map((session) => session.id);
  const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    select: { id: true }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map(
    (session) => session.id
  );
  const conversations = await prisma.formativeConversationSession.findMany({
    where: {
      concept_unit_session_db_id: { in: conceptUnitSessionIds }
    },
    select: { id: true }
  });
  const conversationIds = conversations.map(
    (conversation) => conversation.id
  );
  const agentCalls = await prisma.agentCall.findMany({
    where: {
      assessment_session_db_id: { in: sessionIds }
    },
    select: { id: true }
  });
  const agentCallIds = agentCalls.map((call) => call.id);

  await prisma.formativeConversationProfileEvidenceReference.deleteMany({
    where: {
      formative_conversation_session_db_id: { in: conversationIds }
    }
  });
  await prisma.formativeConversationProfileTransitionTurnReference.deleteMany({
    where: {
      profile_transition: {
        formative_conversation_session_db_id: { in: conversationIds }
      }
    }
  });
  await prisma.formativeConversationProfileTransition.deleteMany({
    where: {
      formative_conversation_session_db_id: { in: conversationIds }
    }
  });
  await prisma.formativeConversationInputTelemetry.deleteMany({
    where: {
      formative_conversation_session_db_id: { in: conversationIds }
    }
  });
  await prisma.formativeConversationTurnTelemetry.deleteMany({
    where: {
      formative_conversation_session_db_id: { in: conversationIds }
    }
  });
  await prisma.formativeConversationLifecycleEvent.deleteMany({
    where: {
      formative_conversation_session_db_id: { in: conversationIds }
    }
  });
  await prisma.formativeConversationReviewSignal.deleteMany({
    where: {
      formative_conversation_session_db_id: { in: conversationIds }
    }
  });
  await prisma.formativeConversationIntervention.deleteMany({
    where: {
      formative_conversation_session_db_id: { in: conversationIds }
    }
  });
  await prisma.formativeConversationMemorySnapshot.deleteMany({
    where: {
      formative_conversation_session_db_id: { in: conversationIds }
    }
  });
  await prisma.formativeConversationMessageReceipt.deleteMany({
    where: {
      formative_conversation_session_db_id: { in: conversationIds }
    }
  });
  await prisma.formativeConversationSession.deleteMany({
    where: { id: { in: conversationIds } }
  });
  await prisma.operationalAgentEffectiveResult.deleteMany({
    where: { agent_call_db_id: { in: agentCallIds } }
  });
  await prisma.studentProfile.deleteMany({
    where: {
      concept_unit_session_db_id: { in: conceptUnitSessionIds }
    }
  });
  await prisma.responsePackage.deleteMany({
    where: {
      concept_unit_session_db_id: { in: conceptUnitSessionIds }
    }
  });
  await prisma.agentCall.deleteMany({
    where: { id: { in: agentCallIds } }
  });
  await prisma.processEvent.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.conversationTurn.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.itemResponse.deleteMany({
    where: {
      concept_unit_session_db_id: { in: conceptUnitSessionIds }
    }
  });
  await prisma.conceptUnitSession.deleteMany({
    where: { id: { in: conceptUnitSessionIds } }
  });
  await prisma.assessmentSession.deleteMany({
    where: { id: { in: sessionIds } }
  });
  await prisma.item.deleteMany({
    where: {
      concept_unit: { assessment_db_id: { in: assessmentIds } }
    }
  });
  await prisma.conceptUnit.deleteMany({
    where: { assessment_db_id: { in: assessmentIds } }
  });
  await prisma.assessment.deleteMany({
    where: { id: { in: assessmentIds } }
  });
  await prisma.user.deleteMany({
    where: { user_id: { startsWith: runPublicId } }
  });
}

export function hashSyntheticValidationArtifact(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}
