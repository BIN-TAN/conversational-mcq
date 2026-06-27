import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import {
  recordConfidence,
  recordReasoning,
  recordSelectedOption,
  recordTemptingOption
} from "../src/lib/services/student-assessment/service";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import type { StudentSessionState } from "../src/lib/student-assessment-ui/types";

export type MvpPathChoice = "move_next" | "try_another";

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertStudentVisibleTextIsSafe(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "response profile",
    "formative need",
    "metadata",
    "answer key",
    "system prompt",
    "structured output",
    "agent call",
    "correct_option",
    "correctness",
    "ability_profile",
    "engagement_profile",
    "integrated_diagnostic_profile",
    "formative_value"
  ];

  for (const term of forbidden) {
    assert(!serialized.includes(term), `Student-visible payload leaked ${term}.`);
  }
}

export function itemRole(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const role = (value as Record<string, unknown>).item_role;
  return typeof role === "string" ? role : null;
}

export async function createSmokeStudent(input: {
  prisma: PrismaClient;
  prefix: string;
  accessCode: string;
}) {
  return input.prisma.user.create({
    data: {
      user_id: input.prefix,
      user_id_normalized: normalizeUserId(input.prefix),
      role: "student",
      access_code_hash: await hashSecret(input.accessCode)
    },
    select: { id: true, user_id: true }
  });
}

export async function cleanupSmokeStudentSessions(input: {
  prisma: PrismaClient;
  userDbId: string;
  sessionPublicIds: string[];
}) {
  const sessions = await input.prisma.assessmentSession.findMany({
    where: {
      OR: [
        { user_db_id: input.userDbId },
        { session_public_id: { in: input.sessionPublicIds } }
      ]
    },
    select: { id: true }
  });
  const sessionIds = sessions.map((session) => session.id);
  const conceptUnitSessions = await input.prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    select: { id: true }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map((session) => session.id);

  await input.prisma.workflowJob.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.workflowOverride.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.studentActionIdempotencyKey.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.responsePackage.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await input.prisma.processEvent.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.conversationTurn.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.agentCall.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.followupRound.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await input.prisma.formativeDecision.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await input.prisma.studentProfile.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await input.prisma.itemResponse.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await input.prisma.conceptUnitSession.deleteMany({
    where: { id: { in: conceptUnitSessionIds } }
  });
  await input.prisma.assessmentSession.deleteMany({
    where: { id: { in: sessionIds } }
  });
  await input.prisma.user.deleteMany({ where: { id: input.userDbId } });
}

export async function completeInitialItem(input: {
  studentDbId: string;
  sessionPublicId: string;
  prefix: string;
  state: StudentSessionState;
  itemIndex: number;
  withTemptingReason?: boolean;
}) {
  const item = input.state.current_item;
  assert(item, `Expected initial item ${input.itemIndex}.`);
  const selectedOption = item.options[0]?.label;
  assert(selectedOption, `Initial item ${input.itemIndex} needs an answer option.`);

  let state = (
    await recordSelectedOption({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        selected_option: selectedOption,
        client_action_id: `${input.prefix}_initial${input.itemIndex}_answer`
      }
    })
  ).state;
  state = (
    await recordReasoning({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        reasoning_text: `Initial item ${input.itemIndex} reasoning compares theta with item parameters.`,
        client_action_id: `${input.prefix}_initial${input.itemIndex}_reason`
      }
    })
  ).state;
  state = (
    await recordConfidence({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        confidence_rating: input.itemIndex === 2 ? "medium" : "high",
        client_action_id: `${input.prefix}_initial${input.itemIndex}_confidence`
      }
    })
  ).state;

  if (input.withTemptingReason) {
    const temptingOption =
      item.options.find((option) => option.label !== selectedOption)?.label ?? item.options[1]?.label;
    assert(temptingOption, `Initial item ${input.itemIndex} needs a tempting option.`);
    state = (
      await recordTemptingOption({
        student_user_db_id: input.studentDbId,
        session_public_id: input.sessionPublicId,
        item_public_id: item.item_public_id,
        data: {
          tempting_option: temptingOption,
          client_action_id: `${input.prefix}_initial${input.itemIndex}_tempting`
        }
      })
    ).state;
    state = (
      await recordTemptingOption({
        student_user_db_id: input.studentDbId,
        session_public_id: input.sessionPublicId,
        item_public_id: item.item_public_id,
        data: {
          tempting_option_reason: "It used similar language about item parameters.",
          client_action_id: `${input.prefix}_initial${input.itemIndex}_tempting_reason`
        }
      })
    ).state;
  } else {
    state = (
      await recordTemptingOption({
        student_user_db_id: input.studentDbId,
        session_public_id: input.sessionPublicId,
        item_public_id: item.item_public_id,
        data: {
          no_tempting_option: true,
          client_action_id: `${input.prefix}_initial${input.itemIndex}_tempting_no`
        }
      })
    ).state;
  }

  return state;
}

export async function completeTransferItem(input: {
  studentDbId: string;
  sessionPublicId: string;
  prefix: string;
  state: StudentSessionState;
}) {
  const transferItem = input.state.current_item;
  assert(transferItem, "Transfer item should be present.");
  const selectedOption = transferItem.options[2]?.label ?? transferItem.options[0]?.label;
  const temptingOption = transferItem.options.find((option) => option.label !== selectedOption)?.label;
  assert(selectedOption, "Transfer item needs a selected option.");
  assert(temptingOption, "Transfer item needs an alternate tempting option.");

  let state = (
    await recordSelectedOption({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: transferItem.item_public_id,
      data: {
        selected_option: selectedOption,
        client_action_id: `${input.prefix}_transfer_answer`
      }
    })
  ).state;
  assert(state.assessment_state === "AWAIT_REASON", "Transfer answer should advance to reason.");

  state = (
    await recordReasoning({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: transferItem.item_public_id,
      data: {
        reasoning_text:
          "The estimates are on the same linked theta scale, even if the item mix affects precision.",
        client_action_id: `${input.prefix}_transfer_reason`
      }
    })
  ).state;
  assert(state.assessment_state === "AWAIT_CONFIDENCE", "Transfer reason should advance to confidence.");

  state = (
    await recordConfidence({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: transferItem.item_public_id,
      data: {
        confidence_rating: "high",
        client_action_id: `${input.prefix}_transfer_confidence`
      }
    })
  ).state;
  assert(
    state.assessment_state === "AWAIT_TEMPTING_OPTION",
    "Transfer confidence should advance to tempting option."
  );

  state = (
    await recordTemptingOption({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: transferItem.item_public_id,
      data: {
        tempting_option: temptingOption,
        client_action_id: `${input.prefix}_transfer_tempting`
      }
    })
  ).state;
  assert(
    state.assessment_state === "AWAIT_TEMPTING_REASON",
    "Transfer tempting option should ask for a reason."
  );

  state = (
    await recordTemptingOption({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: transferItem.item_public_id,
      data: {
        tempting_option_reason: "It sounded plausible because it mentioned the item difficulty mix.",
        client_action_id: `${input.prefix}_transfer_tempting_reason`
      }
    })
  ).state;
  assert(state.assessment_state === "SESSION_COMPLETE", "Transfer completion should complete the session.");

  return {
    state,
    selectedOption,
    temptingOption,
    transferItemPublicId: transferItem.item_public_id
  };
}

export function eventCounts(events: Array<{ event_type: string }>) {
  return events.reduce<Record<string, number>>((counts, event) => {
    counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
    return counts;
  }, {});
}

export function assertEventsPresent(counts: Record<string, number>, expected: string[]) {
  for (const eventType of expected) {
    assert((counts[eventType] ?? 0) > 0, `Missing process event ${eventType}.`);
  }
}

function stripUnsafeValue(value: string) {
  return value.replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_SECRET_LIKE_TOKEN]");
}

function safeForEvidenceExport(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return stripUnsafeValue(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => safeForEvidenceExport(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return safeForEvidenceExport((value as { toJSON: () => unknown }).toJSON());
  }

  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (
      key === "id" ||
      key.endsWith("_db_id") ||
      key.endsWith("_db_ids") ||
      /password|access_code|api_key|authorization|cookie|session_secret|database_url|credential|bearer|private_key/i.test(key)
    ) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = safeForEvidenceExport(entry);
    }
  }

  return output;
}

function payloadSource(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = (value as Record<string, unknown>).source;
  return typeof source === "string" ? source : null;
}

function payloadMessageType(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const messageType = (value as Record<string, unknown>).message_type;
  return typeof messageType === "string" ? messageType : null;
}

export async function collectMvpSessionEvidence(input: {
  prisma: PrismaClient;
  sessionPublicId: string;
  scenario: string;
}) {
  const session = await input.prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: input.sessionPublicId },
    select: {
      id: true,
      session_public_id: true,
      attempt_number: true,
      status: true,
      current_phase: true,
      started_at: true,
      last_activity_at: true,
      completed_at: true,
      user: {
        select: {
          user_id: true,
          display_name: true,
          role: true
        }
      },
      assessment: {
        select: {
          assessment_public_id: true,
          title: true,
          status: true
        }
      }
    }
  });
  const conceptUnitSessions = await input.prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: session.id },
    orderBy: [{ created_at: "asc" }],
    select: {
      id: true,
      status: true,
      initial_started_at: true,
      initial_completed_at: true,
      followup_started_at: true,
      followup_completed_at: true,
      followup_status: true,
      followup_round_count: true,
      concept_unit: {
        select: {
          concept_unit_public_id: true,
          title: true,
          order_index: true
        }
      }
    }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map((conceptUnitSession) => conceptUnitSession.id);
  const itemResponses = await input.prisma.itemResponse.findMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } },
    orderBy: [{ item: { item_order: "asc" } }, { created_at: "asc" }],
    select: {
      selected_option: true,
      correct_option_snapshot: true,
      correctness: true,
      reasoning_text: true,
      confidence_rating: true,
      item_response_time_ms: true,
      item_started_at: true,
      item_submitted_at: true,
      skipped_reasoning: true,
      skipped_confidence: true,
      skipped_item: true,
      revision_count: true,
      item_version_snapshot: true,
      item_snapshot: true,
      created_at: true,
      updated_at: true,
      item: {
        select: {
          item_public_id: true,
          item_order: true,
          included_in_published_set: true,
          administration_rules: true
        }
      }
    }
  });
  const conversationTurns = await input.prisma.conversationTurn.findMany({
    where: { assessment_session_db_id: session.id },
    orderBy: [{ created_at: "asc" }],
    select: {
      phase: true,
      actor_type: true,
      agent_name: true,
      message_text: true,
      structured_payload: true,
      created_at: true,
      item: {
        select: {
          item_public_id: true,
          item_order: true
        }
      }
    }
  });
  const processEvents = await input.prisma.processEvent.findMany({
    where: { assessment_session_db_id: session.id },
    orderBy: [{ occurred_at: "asc" }],
    select: {
      event_type: true,
      event_category: true,
      event_source: true,
      visibility_duration_ms: true,
      pause_duration_ms: true,
      payload: true,
      occurred_at: true,
      created_at: true,
      item: {
        select: {
          item_public_id: true,
          item_order: true
        }
      }
    }
  });
  const responsePackages = await input.prisma.responsePackage.findMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } },
    orderBy: [{ created_at: "asc" }],
    select: {
      package_type: true,
      payload: true,
      created_at: true
    }
  });
  const studentProfiles = await input.prisma.studentProfile.findMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } },
    orderBy: [{ created_at: "asc" }]
  });
  const formativeDecisions = await input.prisma.formativeDecision.findMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } },
    orderBy: [{ created_at: "asc" }]
  });
  const followupRounds = await input.prisma.followupRound.findMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } },
    orderBy: [{ round_index: "asc" }]
  });
  const agentCalls = await input.prisma.agentCall.findMany({
    where: { assessment_session_db_id: session.id },
    orderBy: [{ created_at: "asc" }],
    select: {
      agent_name: true,
      agent_version: true,
      model_name: true,
      provider: true,
      provider_response_id: true,
      provider_request_id: true,
      client_request_id: true,
      prompt_hash: true,
      prompt_version: true,
      schema_version: true,
      input_payload: true,
      raw_output: true,
      output_payload: true,
      output_validated: true,
      validation_error: true,
      refusal_text: true,
      incomplete_reason: true,
      error_category: true,
      blocked_reason: true,
      live_call_allowed: true,
      retry_count: true,
      call_status: true,
      latency_ms: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true,
      token_usage: true,
      estimated_cost: true,
      started_at: true,
      completed_at: true,
      created_at: true
    }
  });

  const targetedFeedback = conversationTurns.filter(
    (turn) => payloadSource(turn.structured_payload) === "chat_native_targeted_feedback"
  );
  const revisions = conversationTurns.filter(
    (turn) => payloadSource(turn.structured_payload) === "chat_native_revision"
  );
  const nextChoices = conversationTurns.filter(
    (turn) => payloadSource(turn.structured_payload) === "chat_native_next_choice"
  );
  const formativeActivities = conversationTurns.filter(
    (turn) =>
      payloadSource(turn.structured_payload) === "chat_native_formative_activity" ||
      payloadMessageType(turn.structured_payload) === "matched_formative_activity"
  );
  const transferResponses = itemResponses.filter(
    (response) => itemRole(response.item.administration_rules) === "transfer"
  );

  return safeForEvidenceExport({
    export_type: "chat_native_mvp_e2e_evidence",
    export_version: "phase8-mvp-e2e-v1",
    generated_at: new Date().toISOString(),
    scenario: input.scenario,
    session_summary: {
      session_public_id: session.session_public_id,
      user_id: session.user.user_id,
      student_display_name: session.user.display_name,
      assessment_public_id: session.assessment.assessment_public_id,
      assessment_title: session.assessment.title,
      attempt_number: session.attempt_number,
      status: session.status,
      current_phase: session.current_phase,
      started_at: session.started_at,
      last_activity_at: session.last_activity_at,
      completed_at: session.completed_at
    },
    concept_unit_sessions: conceptUnitSessions,
    item_responses: itemResponses,
    transfer_response: transferResponses[0] ?? null,
    conversation_turns: conversationTurns,
    process_events: processEvents,
    response_packages: responsePackages,
    formative_profile: studentProfiles[0] ?? null,
    formative_decision: formativeDecisions[0] ?? null,
    followup_rounds: followupRounds,
    targeted_feedback: targetedFeedback,
    revision_turns: revisions,
    next_choice_turns: nextChoices,
    formative_activity_turns: formativeActivities,
    agent_calls: agentCalls
  });
}

export async function writeMvpSessionEvidence(input: {
  evidence: unknown;
  scenario: string;
  sessionPublicId: string;
}) {
  const outDir = path.join(process.cwd(), ".data", "student-mvp-e2e-smoke");
  await mkdir(outDir, { recursive: true });
  const safeScenario = input.scenario.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(outDir, `${safeScenario}-${input.sessionPublicId}.json`);
  await writeFile(filePath, `${JSON.stringify(input.evidence, null, 2)}\n`, "utf8");
  return filePath;
}

export function hashEvidenceShape(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
