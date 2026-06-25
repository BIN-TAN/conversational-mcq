import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  FollowupUpdateTriggerTypeSchema,
  type FollowupUpdatePostCycleAction,
  type FollowupUpdateTriggerType
} from "@/lib/domain/enums";
import { executeAgent } from "@/lib/agents/execute-agent";
import {
  FollowupInput,
  FollowupOutput,
  FormativePlanningOutput,
  StudentProfileOutput,
  type AgentInputByName,
  type AgentOutputByName
} from "@/lib/agents/contracts";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import { validateFollowupSemantics } from "@/lib/agents/followup/semantic-validation";
import {
  getFollowupContextConfig,
  truncateForFollowupProvider
} from "@/lib/agents/followup/context";
import { executeStudentProfilingCandidate } from "@/lib/agents/student-profiling/service";
import { executeFormativePlanningCandidate } from "@/lib/agents/formative-planning/service";
import { prisma } from "@/lib/db";
import { enqueueWorkflowJob } from "@/lib/workflow/jobs";
import { getGuardedOperationalAgentIntegrationReadiness } from "@/lib/operational/guarded-agent-integration";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { logProcessEvent } from "@/lib/services/process-events";
import { aggregateProcessEventsByConceptUnitSession } from "@/lib/services/process-events";
import {
  serializeDate,
  stripInternalKeys
} from "@/lib/services/teacher-review/serializers";

export class FollowupUpdateCycleError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status = 400,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "FollowupUpdateCycleError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const activeCycleStatuses = [
  "pending",
  "profiling",
  "profiling_completed",
  "planning",
  "planning_completed",
  "opening",
  "committing"
] as const;

type StudentProfileAgentOutput = AgentOutputByName["student_profiling_agent"];
type PlanningAgentOutput = AgentOutputByName["formative_value_and_planning_agent"];
type FollowupAgentOutput = AgentOutputByName["followup_agent"];
type FollowupAgentInput = AgentInputByName["followup_agent"];

const triggerDetailsSchema = z.object({
  reason: z.string().optional(),
  source: z.string().optional(),
  student_turn_db_id: z.string().uuid().optional(),
  assistant_turn_db_id: z.string().uuid().optional(),
  evidence_trigger_reasons: z.array(z.string()).optional(),
  substantive_turn_count_since_last_update: z.number().int().nonnegative().optional(),
  progression_public_id: z.string().optional(),
  requested_by_user_db_id: z.string().uuid().optional()
}).passthrough();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function json(value: unknown): Prisma.InputJsonValue {
  return (toPrismaJson(value) ?? Prisma.JsonNull) as Prisma.InputJsonValue;
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function outputReason(result: {
  status: string;
  agent_call_id?: string | null;
  retry_count?: number;
}) {
  return {
    result_status: result.status,
    agent_call_id: result.agent_call_id ?? null,
    retry_count: result.retry_count ?? 0
  };
}

async function logUpdateEvent(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  event_type:
    | "followup_update_triggered"
    | "followup_evidence_package_created"
    | "followup_profile_update_started"
    | "followup_profile_update_succeeded"
    | "followup_profile_update_failed"
    | "followup_planning_update_started"
    | "followup_planning_update_succeeded"
    | "followup_planning_update_failed"
    | "followup_update_cycle_completed"
    | "followup_update_cycle_failed"
    | "followup_final_update_started"
    | "followup_final_update_completed"
    | "followup_final_update_failed";
  payload?: Record<string, unknown>;
}) {
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: input.event_type,
    event_category: "followup_update",
    event_source: "backend",
    payload: input.payload,
    occurred_at: new Date()
  });
}

function profileCreateData(input: {
  concept_unit_session_db_id: string;
  based_on_agent_call_db_id: string | null;
  output: StudentProfileAgentOutput;
}) {
  return {
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    profile_type: input.output.profile_type,
    ability_profile: input.output.ability_profile,
    ability_pattern_flags: json(input.output.ability_pattern_flags),
    engagement_profile: input.output.engagement_profile,
    engagement_pattern_flags: json(input.output.engagement_pattern_flags),
    integrated_diagnostic_profile: input.output.integrated_diagnostic_profile,
    integrated_profile_confidence: input.output.integrated_profile_confidence,
    integrated_profile_rationale: input.output.integrated_profile_rationale,
    evidence_sufficiency: input.output.evidence_sufficiency,
    confidence_alignment: input.output.confidence_alignment,
    independence_interpretability: input.output.independence_interpretability,
    misconception_indicators: json(input.output.misconception_indicators),
    item_level_evidence: json(input.output.item_level_evidence),
    reasoning_quality_summary: input.output.reasoning_quality_summary,
    engagement_summary: input.output.engagement_summary,
    process_interpretation_cautions: json(input.output.process_interpretation_cautions),
    profile_confidence: input.output.profile_confidence,
    rationale: input.output.rationale,
    recommended_next_evidence: json(input.output.recommended_next_evidence),
    based_on_agent_call_db_id: input.based_on_agent_call_db_id
  };
}

function decisionCreateData(input: {
  concept_unit_session_db_id: string;
  student_profile_db_id: string;
  based_on_agent_call_db_id: string | null;
  output: PlanningAgentOutput;
}) {
  return {
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    student_profile_db_id: input.student_profile_db_id,
    formative_value: input.output.formative_value,
    formative_action_plan: input.output.formative_action_plan,
    target_evidence: json(input.output.target_evidence),
    success_criteria: json(input.output.success_criteria),
    followup_prompt_constraints: json(input.output.followup_prompt_constraints),
    profile_update_triggers: json(input.output.profile_update_triggers),
    rationale: input.output.rationale,
    mapping_followed: input.output.mapping_followed,
    mapping_deviation_reason: input.output.mapping_deviation_reason,
    based_on_agent_call_db_id: input.based_on_agent_call_db_id
  };
}

function stripFollowupAuditKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripFollowupAuditKeys);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === "agent_call_id") {
      continue;
    }

    output[key] = stripFollowupAuditKeys(entry);
  }

  return output;
}

function safePayload(value: unknown) {
  return stripFollowupAuditKeys(stripInternalKeys(value));
}

function triggerTypeFromAssistantOutput(input: {
  output: Pick<
    FollowupAgentOutput,
    "evidence_trigger_candidate" | "evidence_trigger_reasons" | "student_turn_substantive"
  >;
  substantive_turn_count: number;
  threshold: number;
}): FollowupUpdateTriggerType | null {
  const reasons = new Set(input.output.evidence_trigger_reasons);

  if (input.output.evidence_trigger_candidate) {
    return "agent_evidence_candidate";
  }

  if (reasons.has("reasoning_revision")) {
    return "reasoning_revision";
  }

  if (reasons.has("task_completion")) {
    return "task_completion";
  }

  if (reasons.has("transfer_application")) {
    return "transfer_application";
  }

  if (reasons.has("understanding_claim")) {
    return "understanding_claim";
  }

  if (reasons.has("move_on_request")) {
    return "move_on_request";
  }

  if (input.output.student_turn_substantive && input.substantive_turn_count >= input.threshold) {
    return "substantive_turn_threshold";
  }

  return null;
}

async function activeCycle(conceptUnitSessionDbId: string) {
  return prisma.followupUpdateCycle.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSessionDbId,
      status: { in: [...activeCycleStatuses] }
    },
    orderBy: [{ created_at: "desc" }]
  });
}

async function countSubstantiveAssistantClassifications(input: {
  followup_round_db_id: string;
}) {
  const turns = await prisma.conversationTurn.findMany({
    where: {
      followup_round_db_id: input.followup_round_db_id,
      actor_type: "agent"
    },
    select: {
      structured_payload: true
    }
  });

  return turns.filter((turn) => {
    const payload = asRecord(turn.structured_payload);
    return payload.student_turn_substantive === true;
  }).length;
}

async function latestStudentTurn(roundDbId: string) {
  return prisma.conversationTurn.findFirst({
    where: {
      followup_round_db_id: roundDbId,
      actor_type: "student"
    },
    orderBy: [{ created_at: "desc" }]
  });
}

async function buildFollowupEvidencePackagePayload(input: {
  cycle_public_id: string;
  concept_unit_session_db_id: string;
  source_followup_round_db_id: string;
  source_student_profile_db_id: string;
  source_formative_decision_db_id: string;
  trigger_type: FollowupUpdateTriggerType;
  trigger_details: Record<string, unknown>;
  evidence_cutoff_turn_db_id: string | null;
  evidence_cutoff_at: Date | null;
  created_at: Date;
}) {
  const conceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: input.concept_unit_session_db_id },
    include: {
      assessment_session: {
        select: {
          session_public_id: true,
          attempt_number: true,
          status: true,
          current_phase: true,
          started_at: true,
          last_activity_at: true,
          user: {
            select: { user_id: true }
          },
          assessment: {
            select: {
              assessment_public_id: true,
              title: true,
              description: true
            }
          }
        }
      },
      concept_unit: {
        include: {
          items: {
            where: {
              status: "published",
              included_in_published_set: true
            },
            orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
          }
        }
      },
      item_responses: {
        orderBy: [{ item: { item_order: "asc" } }, { created_at: "asc" }],
        include: {
          item: {
            select: {
              item_public_id: true,
              item_order: true
            }
          }
        }
      }
    }
  });
  const sourceRound = await prisma.followupRound.findUniqueOrThrow({
    where: { id: input.source_followup_round_db_id },
    include: {
      formative_decision: {
        select: {
          created_at: true,
          formative_value: true
        }
      }
    }
  });
  const sourceProfile = await prisma.studentProfile.findUniqueOrThrow({
    where: { id: input.source_student_profile_db_id },
    select: {
      created_at: true,
      profile_type: true,
      integrated_diagnostic_profile: true
    }
  });
  const cutoffAt = input.evidence_cutoff_at ?? new Date();
  const roundTurns = await prisma.conversationTurn.findMany({
    where: {
      followup_round_db_id: sourceRound.id,
      created_at: { lte: cutoffAt }
    },
    orderBy: [{ created_at: "asc" }]
  });
  const processWindowStart = sourceRound.started_at ?? conceptUnitSession.followup_started_at;
  const processEvents = await prisma.processEvent.findMany({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      occurred_at: {
        ...(processWindowStart ? { gte: processWindowStart } : {}),
        lte: cutoffAt
      }
    },
    orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }]
  });
  const processCounts = await aggregateProcessEventsByConceptUnitSession(conceptUnitSession.id);
  const sourceTurnPayloads = roundTurns.map((turn) => {
    const payload = asRecord(turn.structured_payload);

    return {
      actor_type: turn.actor_type,
      agent_name: turn.agent_name,
      phase: turn.phase,
      message_text: turn.message_text,
      created_at: turn.created_at.toISOString(),
      structured_payload: safePayload(payload),
      student_turn_substantive: payload.student_turn_substantive === true,
      evidence_trigger_candidate: payload.evidence_trigger_candidate === true,
      evidence_trigger_reasons: Array.isArray(payload.evidence_trigger_reasons)
        ? payload.evidence_trigger_reasons.filter((entry) => typeof entry === "string")
        : []
    };
  });

  return {
    package_type: "followup_evidence_update_package",
    package_version: "phase6d2b-v1",
    created_at: input.created_at.toISOString(),
    cycle_public_id: input.cycle_public_id,
    trigger_type: input.trigger_type,
    trigger_details: safePayload(input.trigger_details),
    evidence_cutoff_at: cutoffAt.toISOString(),
    evidence_cutoff_turn: input.evidence_cutoff_turn_db_id
      ? {
          turn_timestamp: cutoffAt.toISOString(),
          note: "Internal turn id stored only on followup_update_cycles."
        }
      : null,
    source_records: {
      session_public_id: conceptUnitSession.assessment_session.session_public_id,
      concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
      source_followup_round_index: sourceRound.round_index,
      source_student_profile: {
        profile_type: sourceProfile.profile_type,
        integrated_diagnostic_profile: sourceProfile.integrated_diagnostic_profile,
        created_at: sourceProfile.created_at.toISOString()
      },
      source_formative_decision: {
        formative_value: sourceRound.formative_decision.formative_value,
        created_at: sourceRound.formative_decision.created_at.toISOString()
      }
    },
    assessment_session: {
      session_public_id: conceptUnitSession.assessment_session.session_public_id,
      attempt_number: conceptUnitSession.assessment_session.attempt_number,
      status: conceptUnitSession.assessment_session.status,
      current_phase: conceptUnitSession.assessment_session.current_phase,
      started_at: serializeDate(conceptUnitSession.assessment_session.started_at),
      last_activity_at: serializeDate(conceptUnitSession.assessment_session.last_activity_at)
    },
    assessment: {
      assessment_public_id:
        conceptUnitSession.assessment_session.assessment.assessment_public_id,
      title: conceptUnitSession.assessment_session.assessment.title,
      description: conceptUnitSession.assessment_session.assessment.description
    },
    student: {
      user_id: conceptUnitSession.assessment_session.user.user_id
    },
    concept_unit: {
      concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
      title: conceptUnitSession.concept_unit.title,
      learning_objective: conceptUnitSession.concept_unit.learning_objective,
      related_concept_description:
        conceptUnitSession.concept_unit.related_concept_description,
      administration_rules: safePayload(conceptUnitSession.concept_unit.administration_rules),
      order_index: conceptUnitSession.concept_unit.order_index,
      version: conceptUnitSession.concept_unit.version
    },
    included_items: conceptUnitSession.concept_unit.items.map((item) => ({
      item_public_id: item.item_public_id,
      item_order: item.item_order,
      item_stem: item.item_stem,
      options: safePayload(item.options),
      correct_option: item.correct_option,
      distractor_rationales: safePayload(item.distractor_rationales),
      expected_reasoning_patterns: safePayload(item.expected_reasoning_patterns),
      possible_misconception_indicators: safePayload(
        item.possible_misconception_indicators
      ),
      version: item.version
    })),
    initial_item_response_context: conceptUnitSession.item_responses.map((response) => ({
      item_public_id: response.item.item_public_id,
      item_order: response.item.item_order,
      selected_option: response.selected_option,
      correctness: response.correctness,
      reasoning_text: response.reasoning_text,
      confidence_rating: response.confidence_rating,
      skipped_item: response.skipped_item,
      skipped_reasoning: response.skipped_reasoning,
      skipped_confidence: response.skipped_confidence,
      revision_count: response.revision_count,
      item_response_time_ms: response.item_response_time_ms,
      item_started_at: serializeDate(response.item_started_at),
      item_submitted_at: serializeDate(response.item_submitted_at),
      item_version_snapshot: response.item_version_snapshot,
      item_snapshot: safePayload(response.item_snapshot)
    })),
    followup_round: {
      round_index: sourceRound.round_index,
      status: sourceRound.status,
      started_at: serializeDate(sourceRound.started_at),
      completed_at: serializeDate(sourceRound.completed_at)
    },
    followup_turns: sourceTurnPayloads,
    substantive_turn_count: sourceTurnPayloads.filter((turn) => turn.student_turn_substantive)
      .length,
    process_event_aggregates: safePayload(processCounts),
    process_events: processEvents.map((event) => ({
      event_type: event.event_type,
      event_category: event.event_category,
      event_source: event.event_source,
      visibility_duration_ms: event.visibility_duration_ms,
      pause_duration_ms: event.pause_duration_ms,
      payload: safePayload(event.payload),
      occurred_at: event.occurred_at.toISOString()
    })),
    interpretation_boundary:
      "Process data are contextual evidence for engagement and evidence sufficiency, not misconduct evidence."
  };
}

async function createCycle(input: {
  concept_unit_session_db_id: string;
  trigger_type: FollowupUpdateTriggerType;
  trigger_details: Record<string, unknown>;
  final_update: boolean;
  create_next_round: boolean;
  stop_after_cycle: boolean;
  post_cycle_action?: FollowupUpdatePostCycleAction;
  progression_record_db_id?: string | null;
  evidence_cutoff_turn_db_id?: string | null;
}) {
  const existing = await activeCycle(input.concept_unit_session_db_id);

  if (existing) {
    if (input.stop_after_cycle || input.final_update) {
      const updated = await prisma.followupUpdateCycle.update({
        where: { id: existing.id },
        data: {
          final_update: true,
          create_next_round: false,
          stop_after_cycle: true,
          post_cycle_action: input.post_cycle_action ?? existing.post_cycle_action,
          progression_record_db_id:
            input.progression_record_db_id ?? existing.progression_record_db_id,
          trigger_details: json({
            ...asRecord(existing.trigger_details),
            stop_requested_after_cycle_creation: true,
            stop_request_details: input.trigger_details
          })
        }
      });

      return { cycle: updated, created: false };
    }

    return { cycle: existing, created: false };
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: input.concept_unit_session_db_id },
    include: {
      assessment_session: {
        select: {
          id: true,
          current_phase: true,
          workflow_mode_snapshot: true
        }
      },
      latest_student_profile: { select: { id: true } },
      latest_formative_decision: { select: { id: true } }
    }
  });

  if (!conceptUnitSession.latest_student_profile) {
    throw new FollowupUpdateCycleError(
      "latest_student_profile_required",
      "A latest active student profile is required before follow-up updating.",
      409
    );
  }

  if (!conceptUnitSession.latest_formative_decision) {
    throw new FollowupUpdateCycleError(
      "latest_formative_decision_required",
      "A latest active formative decision is required before follow-up updating.",
      409
    );
  }

  const sourceRound = await prisma.followupRound.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      status: "active"
    },
    orderBy: [{ round_index: "desc" }]
  });

  if (!sourceRound) {
    throw new FollowupUpdateCycleError(
      "active_followup_round_required",
      "An active follow-up round is required before follow-up updating.",
      409
    );
  }

  const cutoffTurn = input.evidence_cutoff_turn_db_id
    ? await prisma.conversationTurn.findFirst({
        where: {
          id: input.evidence_cutoff_turn_db_id,
          followup_round_db_id: sourceRound.id
        }
      })
    : await latestStudentTurn(sourceRound.id);
  const cyclePublicId = generatePublicId("followup_update_cycle");
  const now = new Date();
  const triggerDetails = triggerDetailsSchema.parse(input.trigger_details);
  const payload = await buildFollowupEvidencePackagePayload({
    cycle_public_id: cyclePublicId,
    concept_unit_session_db_id: conceptUnitSession.id,
    source_followup_round_db_id: sourceRound.id,
    source_student_profile_db_id: conceptUnitSession.latest_student_profile.id,
    source_formative_decision_db_id: conceptUnitSession.latest_formative_decision.id,
    trigger_type: input.trigger_type,
    trigger_details: triggerDetails,
    evidence_cutoff_turn_db_id: cutoffTurn?.id ?? null,
    evidence_cutoff_at: cutoffTurn?.created_at ?? now,
    created_at: now
  });

  try {
    const sourceStudentProfileDbId = conceptUnitSession.latest_student_profile.id;
    const sourceFormativeDecisionDbId = conceptUnitSession.latest_formative_decision.id;
    const cycle = await prisma.$transaction(async (tx) => {
      const responsePackage = await tx.responsePackage.create({
        data: {
          concept_unit_session_db_id: conceptUnitSession.id,
          package_type: "followup_evidence_update_package",
          payload: json(payload)
        }
      });

      return tx.followupUpdateCycle.create({
        data: {
          id: randomUUID(),
          cycle_public_id: cyclePublicId,
          assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
          concept_unit_session_db_id: conceptUnitSession.id,
          source_followup_round_db_id: sourceRound.id,
          source_student_profile_db_id: sourceStudentProfileDbId,
          source_formative_decision_db_id: sourceFormativeDecisionDbId,
          evidence_package_db_id: responsePackage.id,
          evidence_cutoff_turn_db_id: cutoffTurn?.id ?? null,
          evidence_cutoff_at: cutoffTurn?.created_at ?? now,
          trigger_type: input.trigger_type,
          trigger_details: json(triggerDetails),
          final_update: input.final_update,
          create_next_round: input.create_next_round,
          stop_after_cycle: input.stop_after_cycle,
          post_cycle_action: input.post_cycle_action ?? "none",
          progression_record_db_id: input.progression_record_db_id ?? null
        }
      });
    });

    await logUpdateEvent({
      assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
      concept_unit_session_db_id: conceptUnitSession.id,
      event_type: input.final_update
        ? "followup_final_update_started"
        : "followup_update_triggered",
      payload: {
        cycle_public_id: cycle.cycle_public_id,
        trigger_type: cycle.trigger_type,
        final_update: cycle.final_update
      }
    });
    await logUpdateEvent({
      assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
      concept_unit_session_db_id: conceptUnitSession.id,
      event_type: "followup_evidence_package_created",
      payload: {
        cycle_public_id: cycle.cycle_public_id,
        package_type: "followup_evidence_update_package"
      }
    });

    await prisma.assessmentSession.update({
      where: { id: conceptUnitSession.assessment_session_db_id },
      data: {
        current_phase: "followup_profile_update_pending",
        last_activity_at: new Date()
      }
    });

    return { cycle, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const active = await activeCycle(input.concept_unit_session_db_id);

      if (active) {
        return { cycle: active, created: false };
      }
    }

    throw error;
  }
}

export async function enqueueFollowupProfileUpdateJob(cyclePublicId: string) {
  const cycle = await prisma.followupUpdateCycle.findUniqueOrThrow({
    where: { cycle_public_id: cyclePublicId },
    select: {
      id: true,
      cycle_public_id: true,
      assessment_session_db_id: true,
      concept_unit_session_db_id: true,
      evidence_package_db_id: true
    }
  });

  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkEvaluationEvidence: true
  });

  if (!readiness.allowed) {
    return null;
  }

  return enqueueWorkflowJob({
    job_type: "run_followup_profile_update",
    assessment_session_db_id: cycle.assessment_session_db_id,
    concept_unit_session_db_id: cycle.concept_unit_session_db_id,
    idempotency_key: `run_followup_profile_update:${cycle.id}:${cycle.evidence_package_db_id}`,
    payload: {
      step: "run_followup_profile_update",
      cycle_public_id: cycle.cycle_public_id
    }
  });
}

export async function enqueueFollowupPlanningUpdateJob(cyclePublicId: string) {
  const cycle = await prisma.followupUpdateCycle.findUniqueOrThrow({
    where: { cycle_public_id: cyclePublicId },
    select: {
      id: true,
      cycle_public_id: true,
      assessment_session_db_id: true,
      concept_unit_session_db_id: true,
      profile_agent_call_db_id: true
    }
  });

  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkEvaluationEvidence: true
  });

  if (!readiness.allowed) {
    return null;
  }

  return enqueueWorkflowJob({
    job_type: "run_followup_planning_update",
    assessment_session_db_id: cycle.assessment_session_db_id,
    concept_unit_session_db_id: cycle.concept_unit_session_db_id,
    idempotency_key: `run_followup_planning_update:${cycle.id}:${cycle.profile_agent_call_db_id}`,
    payload: {
      step: "run_followup_planning_update",
      cycle_public_id: cycle.cycle_public_id
    }
  });
}

export async function enqueueFollowupFinalizeJob(cyclePublicId: string) {
  const cycle = await prisma.followupUpdateCycle.findUniqueOrThrow({
    where: { cycle_public_id: cyclePublicId },
    select: {
      id: true,
      cycle_public_id: true,
      assessment_session_db_id: true,
      concept_unit_session_db_id: true,
      planning_agent_call_db_id: true
    }
  });

  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkEvaluationEvidence: true
  });

  if (!readiness.allowed) {
    return null;
  }

  return enqueueWorkflowJob({
    job_type: "finalize_followup_update",
    assessment_session_db_id: cycle.assessment_session_db_id,
    concept_unit_session_db_id: cycle.concept_unit_session_db_id,
    idempotency_key: `finalize_followup_update:${cycle.id}:${cycle.planning_agent_call_db_id}`,
    payload: {
      step: "finalize_followup_update",
      cycle_public_id: cycle.cycle_public_id
    }
  });
}

async function enqueuePostCycleProgressionFinalizeJob(input: {
  progression_record_db_id: string | null;
  cycle_public_id: string;
  cycle_db_id: string;
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
}) {
  if (!input.progression_record_db_id) {
    return null;
  }

  const progression = await prisma.conceptProgressionRecord.findUnique({
    where: { id: input.progression_record_db_id },
    select: { progression_public_id: true }
  });

  if (!progression) {
    return null;
  }

  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkEvaluationEvidence: true
  });

  if (!readiness.allowed) {
    return null;
  }

  return enqueueWorkflowJob({
    job_type: "finalize_concept_progression",
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    idempotency_key: `finalize_concept_progression:${input.progression_record_db_id}:${input.cycle_db_id}`,
    payload: {
      step: "finalize_concept_progression",
      progression_public_id: progression.progression_public_id,
      cycle_public_id: input.cycle_public_id
    }
  });
}

export async function handleFollowupAssistantEvidence(input: {
  concept_unit_session_db_id: string;
  followup_round_db_id: string;
  student_turn_db_id: string;
  assistant_turn_db_id: string;
  output: FollowupAgentOutput;
}) {
  const config = getFollowupContextConfig();
  const substantiveTurnCount = await countSubstantiveAssistantClassifications({
    followup_round_db_id: input.followup_round_db_id
  });
  const triggerType = triggerTypeFromAssistantOutput({
    output: input.output,
    substantive_turn_count: substantiveTurnCount,
    threshold: config.substantive_turns_before_update
  });

  if (!triggerType) {
    return {
      triggered: false as const,
      substantive_turn_count: substantiveTurnCount
    };
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: input.concept_unit_session_db_id },
    select: {
      id: true,
      assessment_session: {
        select: {
          workflow_mode_snapshot: true,
          id: true
        }
      }
    }
  });
  const triggerDetails = {
    source: "followup_agent_output",
    student_turn_db_id: input.student_turn_db_id,
    assistant_turn_db_id: input.assistant_turn_db_id,
    evidence_trigger_reasons: input.output.evidence_trigger_reasons,
    evidence_trigger_candidate: input.output.evidence_trigger_candidate,
    substantive_turn_count_since_last_update: substantiveTurnCount,
    threshold: config.substantive_turns_before_update
  };

  const readiness =
    conceptUnitSession.assessment_session.workflow_mode_snapshot === "automatic"
      ? await getGuardedOperationalAgentIntegrationReadiness({
          checkEvaluationEvidence: true
        })
      : null;
  const requiresTeacherReview =
    conceptUnitSession.assessment_session.workflow_mode_snapshot === "manual_review" ||
    (readiness !== null && !readiness.allowed);

  if (requiresTeacherReview) {
    await prisma.assessmentSession.update({
      where: { id: conceptUnitSession.assessment_session.id },
      data: {
        needs_review: true,
        needs_review_reason:
          readiness && !readiness.allowed
            ? `followup_evidence_ready_for_profile_update:${readiness.block_reason}`
            : "followup_evidence_ready_for_profile_update",
        last_activity_at: new Date()
      }
    });
    await logUpdateEvent({
      assessment_session_db_id: conceptUnitSession.assessment_session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      event_type: "followup_update_triggered",
      payload: {
        trigger_type: triggerType,
        workflow_mode: conceptUnitSession.assessment_session.workflow_mode_snapshot,
        action: "teacher_review_required",
        operational_integration_blocked_reason:
          readiness && !readiness.allowed ? readiness.block_reason : null
      }
    });

    return {
      triggered: true as const,
      mode: "manual_review" as const,
      trigger_type: triggerType,
      substantive_turn_count: substantiveTurnCount
    };
  }

  const { cycle, created } = await createCycle({
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    trigger_type: triggerType,
    trigger_details: triggerDetails,
    final_update: false,
    create_next_round: true,
    stop_after_cycle: false,
    evidence_cutoff_turn_db_id: input.student_turn_db_id
  });

  if (created) {
    await enqueueFollowupProfileUpdateJob(cycle.cycle_public_id);
  }

  return {
    triggered: true as const,
    mode: "automatic" as const,
    trigger_type: triggerType,
    cycle_public_id: cycle.cycle_public_id,
    created,
    substantive_turn_count: substantiveTurnCount
  };
}

export async function runManualFollowupUpdate(input: {
  session_public_id: string;
  concept_unit_public_id: string;
  requested_by_user_db_id: string;
}) {
  const conceptUnitSession = await prisma.conceptUnitSession.findFirst({
    where: {
      assessment_session: { session_public_id: input.session_public_id },
      concept_unit: { concept_unit_public_id: input.concept_unit_public_id }
    },
    select: {
      id: true,
      assessment_session: {
        select: {
          workflow_mode_snapshot: true,
          current_phase: true
        }
      }
    }
  });

  if (!conceptUnitSession) {
    throw new FollowupUpdateCycleError(
      "concept_unit_session_not_found",
      "Concept-unit session was not found.",
      404
    );
  }

  if (conceptUnitSession.assessment_session.current_phase !== "followup_active") {
    throw new FollowupUpdateCycleError(
      "followup_not_active",
      "Follow-up updating can be triggered only while follow-up is active.",
      409,
      { current_phase: conceptUnitSession.assessment_session.current_phase }
    );
  }

  const activeRound = await prisma.followupRound.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      status: "active"
    },
    orderBy: [{ round_index: "desc" }]
  });

  if (!activeRound) {
    throw new FollowupUpdateCycleError(
      "active_followup_round_required",
      "No active follow-up round was found.",
      409
    );
  }

  const cutoff = await latestStudentTurn(activeRound.id);
  const { cycle, created } = await createCycle({
    concept_unit_session_db_id: conceptUnitSession.id,
    trigger_type: "teacher_manual",
    trigger_details: {
      source: "teacher_manual",
      requested_by_user_db_id: input.requested_by_user_db_id,
      reason: "teacher_researcher_requested_followup_update"
    },
    final_update: false,
    create_next_round: true,
    stop_after_cycle: false,
    evidence_cutoff_turn_db_id: cutoff?.id ?? null
  });

  if (created) {
    await enqueueFollowupProfileUpdateJob(cycle.cycle_public_id);
  }

  return {
    status: created ? "followup_update_enqueued" : "followup_update_already_active",
    cycle_public_id: cycle.cycle_public_id
  };
}

export async function runFollowupProfileUpdate(cyclePublicId: string) {
  const cycle = await prisma.followupUpdateCycle.findUniqueOrThrow({
    where: { cycle_public_id: cyclePublicId }
  });

  if (cycle.status === "completed") {
    return { status: "already_completed" as const, cycle_public_id: cycle.cycle_public_id };
  }

  if (cycle.staged_profile_output && cycle.profile_agent_call_db_id) {
    await enqueueFollowupPlanningUpdateJob(cycle.cycle_public_id);
    return { status: "profile_update_already_staged" as const };
  }

  if (!cycle.evidence_package_db_id) {
    throw new FollowupUpdateCycleError(
      "evidence_package_required",
      "A follow-up evidence package is required before profiling update.",
      409
    );
  }

  await prisma.followupUpdateCycle.update({
    where: { id: cycle.id },
    data: { status: "profiling" }
  });
  await logUpdateEvent({
    assessment_session_db_id: cycle.assessment_session_db_id,
    concept_unit_session_db_id: cycle.concept_unit_session_db_id,
    event_type: "followup_profile_update_started",
    payload: { cycle_public_id: cycle.cycle_public_id }
  });

  const result = await executeStudentProfilingCandidate({
    concept_unit_session_db_id: cycle.concept_unit_session_db_id,
    followup_evidence_package_db_id: cycle.evidence_package_db_id,
    previous_student_profile_db_id: cycle.source_student_profile_db_id,
    cycle_public_id: cycle.cycle_public_id,
    invocation_reason: "phase6d2b_followup_profile_update"
  });

  if (result.status !== "succeeded" || !result.output) {
    await logUpdateEvent({
      assessment_session_db_id: cycle.assessment_session_db_id,
      concept_unit_session_db_id: cycle.concept_unit_session_db_id,
      event_type: "followup_profile_update_failed",
      payload: outputReason(result)
    });

    return {
      status: result.status,
      agent_call_id: result.agent_call_id,
      retry_count: result.retry_count
    };
  }

  await prisma.followupUpdateCycle.update({
    where: { id: cycle.id },
    data: {
      status: "profiling_completed",
      profile_agent_call_db_id: result.agent_call_id,
      staged_profile_output: json(result.output)
    }
  });
  await logUpdateEvent({
    assessment_session_db_id: cycle.assessment_session_db_id,
    concept_unit_session_db_id: cycle.concept_unit_session_db_id,
    event_type: "followup_profile_update_succeeded",
    payload: {
      cycle_public_id: cycle.cycle_public_id,
      agent_call_id: result.agent_call_id,
      retry_count: result.retry_count
    }
  });
  await prisma.assessmentSession.update({
    where: { id: cycle.assessment_session_db_id },
    data: {
      current_phase: "followup_planning_update_pending",
      last_activity_at: new Date()
    }
  });
  await enqueueFollowupPlanningUpdateJob(cycle.cycle_public_id);

  return {
    status: "profile_update_staged" as const,
    agent_call_id: result.agent_call_id
  };
}

export async function runFollowupPlanningUpdate(cyclePublicId: string) {
  const cycle = await prisma.followupUpdateCycle.findUniqueOrThrow({
    where: { cycle_public_id: cyclePublicId }
  });

  if (cycle.status === "completed") {
    return { status: "already_completed" as const, cycle_public_id: cycle.cycle_public_id };
  }

  if (cycle.staged_planning_output && cycle.planning_agent_call_db_id) {
    await enqueueFollowupFinalizeJob(cycle.cycle_public_id);
    return { status: "planning_update_already_staged" as const };
  }

  if (!cycle.evidence_package_db_id || !cycle.staged_profile_output) {
    throw new FollowupUpdateCycleError(
      "staged_profile_required",
      "A staged profile output and follow-up evidence package are required before planning update.",
      409
    );
  }

  const profileOutput = StudentProfileOutput.parse(cycle.staged_profile_output);

  await prisma.followupUpdateCycle.update({
    where: { id: cycle.id },
    data: { status: "planning" }
  });
  await logUpdateEvent({
    assessment_session_db_id: cycle.assessment_session_db_id,
    concept_unit_session_db_id: cycle.concept_unit_session_db_id,
    event_type: "followup_planning_update_started",
    payload: { cycle_public_id: cycle.cycle_public_id }
  });

  const result = await executeFormativePlanningCandidate({
    concept_unit_session_db_id: cycle.concept_unit_session_db_id,
    followup_evidence_package_db_id: cycle.evidence_package_db_id,
    staged_student_profile_output: profileOutput,
    previous_student_profile_db_id: cycle.source_student_profile_db_id,
    cycle_public_id: cycle.cycle_public_id,
    invocation_reason: "phase6d2b_followup_planning_update"
  });

  if (result.status !== "succeeded" || !result.output) {
    await logUpdateEvent({
      assessment_session_db_id: cycle.assessment_session_db_id,
      concept_unit_session_db_id: cycle.concept_unit_session_db_id,
      event_type: "followup_planning_update_failed",
      payload: outputReason(result)
    });

    return {
      status: result.status,
      agent_call_id: result.agent_call_id,
      retry_count: result.retry_count
    };
  }

  await prisma.followupUpdateCycle.update({
    where: { id: cycle.id },
    data: {
      status: "planning_completed",
      planning_agent_call_db_id: result.agent_call_id,
      staged_planning_output: json(result.output)
    }
  });
  await logUpdateEvent({
    assessment_session_db_id: cycle.assessment_session_db_id,
    concept_unit_session_db_id: cycle.concept_unit_session_db_id,
    event_type: "followup_planning_update_succeeded",
    payload: {
      cycle_public_id: cycle.cycle_public_id,
      agent_call_id: result.agent_call_id,
      retry_count: result.retry_count
    }
  });
  await enqueueFollowupFinalizeJob(cycle.cycle_public_id);

  return {
    status: "planning_update_staged" as const,
    agent_call_id: result.agent_call_id
  };
}

function boundedTranscriptForOpening(
  turns: Array<{
    actor_type: string;
    agent_name: string | null;
    message_text: string | null;
    structured_payload: unknown;
    created_at: Date;
  }>
) {
  const config = getFollowupContextConfig();
  let remainingChars = config.context_max_chars;

  return turns.slice(-config.max_turns).map((turn) => {
    const message = truncateForFollowupProvider(
      turn.message_text ?? "",
      Math.max(0, remainingChars)
    );
    remainingChars = Math.max(0, remainingChars - message.length);

    return {
      actor_type: turn.actor_type,
      agent_name: turn.agent_name,
      message_text: message,
      structured_payload: safePayload(turn.structured_payload),
      created_at: turn.created_at.toISOString()
    };
  });
}

async function executeFollowupOpeningCandidate(input: {
  cycle_public_id: string;
  staged_profile_output: StudentProfileAgentOutput;
  staged_planning_output: PlanningAgentOutput;
}) {
  const cycle = await prisma.followupUpdateCycle.findUniqueOrThrow({
    where: { cycle_public_id: input.cycle_public_id },
    include: {
      source_followup_round: {
        include: {
          conversation_turns: {
            orderBy: [{ created_at: "asc" }],
            select: {
              actor_type: true,
              agent_name: true,
              message_text: true,
              structured_payload: true,
              created_at: true
            }
          }
        }
      },
      concept_unit_session: {
        include: {
          assessment_session: {
            include: {
              assessment: {
                select: {
                  assessment_public_id: true,
                  title: true,
                  description: true,
                  status: true
                }
              },
              user: { select: { user_id: true } }
            }
          },
          concept_unit: true,
          item_responses: {
            include: {
              item: {
                select: {
                  item_public_id: true,
                  item_order: true
                }
              }
            },
            orderBy: [{ item: { item_order: "asc" } }, { created_at: "asc" }]
          }
        }
      }
    }
  });
  const config = getFollowupContextConfig();
  const processContext = await aggregateProcessEventsByConceptUnitSession(
    cycle.concept_unit_session_db_id
  );
  const prompt = getPromptForAgent("followup_agent");
  const planning = input.staged_planning_output;
  const followupInput: FollowupAgentInput = {
    turn_type: "opening",
    latest_student_profile: safePayload(input.staged_profile_output) as Record<string, unknown>,
    latest_formative_decision: safePayload(planning) as Record<string, unknown>,
    formative_action_plan: planning.formative_action_plan,
    target_evidence: planning.target_evidence,
    success_criteria: planning.success_criteria,
    followup_prompt_constraints: planning.followup_prompt_constraints,
    current_followup_round: {
      round_index: cycle.source_followup_round.round_index + 1,
      status: "not_started",
      started_at: null,
      completed_at: null
    },
    recent_followup_transcript: boundedTranscriptForOpening(
      cycle.source_followup_round.conversation_turns
    ),
    student_message: null,
    concept_unit_metadata: {
      assessment: safePayload(cycle.concept_unit_session.assessment_session.assessment),
      assessment_session: {
        session_public_id: cycle.concept_unit_session.assessment_session.session_public_id,
        current_phase: cycle.concept_unit_session.assessment_session.current_phase,
        attempt_number: cycle.concept_unit_session.assessment_session.attempt_number
      },
      student: {
        user_id: cycle.concept_unit_session.assessment_session.user.user_id
      },
      concept_unit: {
        concept_unit_public_id:
          cycle.concept_unit_session.concept_unit.concept_unit_public_id,
        title: cycle.concept_unit_session.concept_unit.title,
        learning_objective: cycle.concept_unit_session.concept_unit.learning_objective,
        related_concept_description:
          cycle.concept_unit_session.concept_unit.related_concept_description,
        order_index: cycle.concept_unit_session.concept_unit.order_index,
        version: cycle.concept_unit_session.concept_unit.version
      }
    },
    relevant_item_evidence: cycle.concept_unit_session.item_responses.map((response) => ({
      item_public_id: response.item.item_public_id,
      item_order: response.item.item_order,
      selected_option: response.selected_option,
      correctness: response.correctness,
      reasoning_text: response.reasoning_text,
      confidence_rating: response.confidence_rating,
      skipped_item: response.skipped_item,
      skipped_reasoning: response.skipped_reasoning,
      skipped_confidence: response.skipped_confidence,
      revision_count: response.revision_count,
      item_snapshot: safePayload(response.item_snapshot),
      item_version_snapshot: response.item_version_snapshot
    })),
    process_context: {
      aggregate_counts: safePayload(processContext),
      interpretation_boundary:
        "Process data are contextual evidence for engagement and evidence sufficiency, not misconduct evidence."
    },
    followup_constraints: {
      backend_update_cycle_completed: true,
      opening_message_must_not_trigger_evidence_update: true,
      no_initial_response_overwrite: true,
      no_student_profile_labels: true,
      no_formative_value_label_to_student: true,
      context_window: {
        max_turns: config.max_turns,
        context_max_chars: config.context_max_chars,
        full_transcript_stored_in_database: true
      },
      prompt_schema_version: prompt.schema_version
    }
  };
  const agentInvocationKey = `followup_opening_update_${stableHash({
    cycle_public_id: cycle.cycle_public_id,
    planning_agent_call_db_id: cycle.planning_agent_call_db_id,
    prompt_version: prompt.prompt_version,
    schema_version: prompt.schema_version,
    prompt_hash: prompt.prompt_hash
  })}`;
  const result = await executeAgent({
    agent_name: "followup_agent",
    input: FollowupInput.parse(followupInput),
    assessment_session_db_id: cycle.assessment_session_db_id,
    concept_unit_session_db_id: cycle.concept_unit_session_db_id,
    followup_round_db_id: cycle.source_followup_round_db_id,
    agent_invocation_key: agentInvocationKey,
    metadata: {
      invocation_reason: "phase6d2b_followup_update_opening",
      turn_type: "opening",
      cycle_public_id: cycle.cycle_public_id
    }
  });

  if (result.status !== "succeeded") {
    return {
      status: result.status,
      output: null,
      agent_call_id: "agent_call_id" in result ? result.agent_call_id : null,
      retry_count: result.retry_count
    };
  }

  validateFollowupSemantics({
    output: result.output,
    current_formative_value: planning.formative_value,
    config,
    turn_type: "opening"
  });

  return {
    status: "succeeded" as const,
    output: result.output,
    agent_call_id: result.agent_call_id,
    retry_count: result.retry_count
  };
}

export async function finalizeFollowupUpdate(cyclePublicId: string) {
  let cycle = await prisma.followupUpdateCycle.findUniqueOrThrow({
    where: { cycle_public_id: cyclePublicId }
  });

  if (cycle.status === "completed") {
    return { status: "already_completed" as const, cycle_public_id: cycle.cycle_public_id };
  }

  if (!cycle.staged_profile_output || !cycle.staged_planning_output) {
    throw new FollowupUpdateCycleError(
      "staged_outputs_required",
      "Staged profile and planning outputs are required before finalization.",
      409
    );
  }

  const profileOutput = StudentProfileOutput.parse(cycle.staged_profile_output);
  const planningOutput = FormativePlanningOutput.parse(cycle.staged_planning_output);

  if (cycle.create_next_round && !cycle.stop_after_cycle && !cycle.staged_opening_output) {
    await prisma.followupUpdateCycle.update({
      where: { id: cycle.id },
      data: { status: "opening" }
    });
    const opening = await executeFollowupOpeningCandidate({
      cycle_public_id: cycle.cycle_public_id,
      staged_profile_output: profileOutput,
      staged_planning_output: planningOutput
    });

    if (opening.status !== "succeeded" || !opening.output) {
      return {
        status: opening.status,
        agent_call_id: opening.agent_call_id,
        retry_count: opening.retry_count
      };
    }

    cycle = await prisma.followupUpdateCycle.update({
      where: { id: cycle.id },
      data: {
        status: "planning_completed",
        opening_agent_call_db_id: opening.agent_call_id,
        staged_opening_output: json(opening.output)
      }
    });
  }

  const openingOutput = cycle.staged_opening_output
    ? FollowupOutput.parse(cycle.staged_opening_output)
    : null;

  await prisma.$transaction(async (tx) => {
    const currentCycle = await tx.followupUpdateCycle.update({
      where: { id: cycle.id },
      data: { status: "committing" }
    });
    const sourceRound = await tx.followupRound.findUniqueOrThrow({
      where: { id: currentCycle.source_followup_round_db_id }
    });
    const now = new Date();
    const profile = await tx.studentProfile.create({
      data: profileCreateData({
        concept_unit_session_db_id: currentCycle.concept_unit_session_db_id,
        based_on_agent_call_db_id: currentCycle.profile_agent_call_db_id,
        output: profileOutput
      })
    });
    const decision = await tx.formativeDecision.create({
      data: decisionCreateData({
        concept_unit_session_db_id: currentCycle.concept_unit_session_db_id,
        student_profile_db_id: profile.id,
        based_on_agent_call_db_id: currentCycle.planning_agent_call_db_id,
        output: planningOutput
      })
    });
    const stopAfterCycle = currentCycle.stop_after_cycle || currentCycle.final_update;

    await tx.followupRound.update({
      where: { id: sourceRound.id },
      data: {
        status: stopAfterCycle ? "stopped" : "completed",
        completed_at: now,
        updated_student_profile_db_id: profile.id,
        evidence_trigger_type: currentCycle.trigger_type
      }
    });

    let newRoundId: string | null = null;

    if (!stopAfterCycle && currentCycle.create_next_round && openingOutput) {
      const newRound = await tx.followupRound.create({
        data: {
          concept_unit_session_db_id: currentCycle.concept_unit_session_db_id,
          round_index: sourceRound.round_index + 1,
          formative_decision_db_id: decision.id,
          status: "active",
          started_at: now,
          evidence_trigger_type: currentCycle.trigger_type
        }
      });

      newRoundId = newRound.id;
      await tx.conversationTurn.create({
        data: {
          assessment_session_db_id: currentCycle.assessment_session_db_id,
          concept_unit_session_db_id: currentCycle.concept_unit_session_db_id,
          followup_round_db_id: newRound.id,
          phase: "followup_active",
          actor_type: "agent",
          agent_name: "followup_agent",
          message_text: openingOutput.assistant_message,
          structured_payload: json({
            agent_call_id: currentCycle.opening_agent_call_db_id,
            followup_action_type: openingOutput.followup_action_type,
            target_formative_value: openingOutput.target_formative_value,
            evidence_request: openingOutput.evidence_request ?? null,
            expects_student_response: openingOutput.expects_student_response,
            evidence_trigger_candidate: openingOutput.evidence_trigger_candidate,
            student_turn_substantive: openingOutput.student_turn_substantive,
            evidence_trigger_reasons: openingOutput.evidence_trigger_reasons,
            should_offer_move_on: openingOutput.should_offer_move_on,
            off_topic_detected: openingOutput.off_topic_detected,
            generated_by_followup_update_cycle: currentCycle.cycle_public_id
          }),
          created_at: now
        }
      });
    }

    await tx.conceptUnitSession.update({
      where: { id: currentCycle.concept_unit_session_db_id },
      data: {
        latest_student_profile_db_id: profile.id,
        latest_formative_decision_db_id: decision.id,
        status: stopAfterCycle ? "followup_completed" : "followup_active",
        followup_status: stopAfterCycle ? "stopped" : "active",
        followup_completed_at: stopAfterCycle ? now : null,
        followup_round_count:
          !stopAfterCycle && newRoundId ? { increment: 1 } : undefined
      }
    });
    await tx.assessmentSession.update({
      where: { id: currentCycle.assessment_session_db_id },
      data: {
        current_phase: stopAfterCycle ? "followup_stopped" : "followup_active",
        last_activity_at: now,
        needs_review: false,
        needs_review_reason: null,
        automation_exception_reason: null
      }
    });
    await tx.followupUpdateCycle.update({
      where: { id: currentCycle.id },
      data: {
        status: "completed",
        completed_at: now
      }
    });
  });

  const refreshed = await prisma.followupUpdateCycle.findUniqueOrThrow({
    where: { cycle_public_id: cyclePublicId }
  });
  await logUpdateEvent({
    assessment_session_db_id: refreshed.assessment_session_db_id,
    concept_unit_session_db_id: refreshed.concept_unit_session_db_id,
    event_type: refreshed.stop_after_cycle || refreshed.final_update
      ? "followup_final_update_completed"
      : "followup_update_cycle_completed",
    payload: {
      cycle_public_id: refreshed.cycle_public_id,
      final_update: refreshed.final_update,
      stop_after_cycle: refreshed.stop_after_cycle
    }
  });

  if (refreshed.post_cycle_action !== "none") {
    await enqueuePostCycleProgressionFinalizeJob({
      progression_record_db_id: refreshed.progression_record_db_id,
      cycle_public_id: refreshed.cycle_public_id,
      cycle_db_id: refreshed.id,
      assessment_session_db_id: refreshed.assessment_session_db_id,
      concept_unit_session_db_id: refreshed.concept_unit_session_db_id
    });
  }

  return { status: "followup_update_completed" as const, cycle_public_id: cyclePublicId };
}

export async function markFollowupUpdateCycleFailed(input: {
  cycle_public_id: string;
  failure_stage: string;
  failure_category: string;
  failure_message: string;
}) {
  const cycle = await prisma.followupUpdateCycle.findUnique({
    where: { cycle_public_id: input.cycle_public_id }
  });

  if (!cycle || cycle.status === "completed") {
    return null;
  }

  const now = new Date();
  const stopAfterCycle = cycle.stop_after_cycle || cycle.final_update;
  const progressionFinalUpdate = cycle.post_cycle_action !== "none";

  await prisma.$transaction(async (tx) => {
    await tx.followupUpdateCycle.update({
      where: { id: cycle.id },
      data: {
        status: "failed",
        failure_stage: input.failure_stage,
        failure_category: input.failure_category,
        failure_message: input.failure_message.slice(0, 1200),
        completed_at: now
      }
    });

    if (stopAfterCycle && progressionFinalUpdate) {
      await tx.assessmentSession.update({
        where: { id: cycle.assessment_session_db_id },
        data: {
          current_phase: "followup_active",
          last_activity_at: now,
          needs_review: false,
          needs_review_reason: null,
          automation_exception_reason: null
        }
      });
    } else if (stopAfterCycle) {
      await tx.followupRound.update({
        where: { id: cycle.source_followup_round_db_id },
        data: {
          status: "stopped",
          completed_at: now
        }
      });
      await tx.conceptUnitSession.update({
        where: { id: cycle.concept_unit_session_db_id },
        data: {
          followup_status: "stopped",
          followup_completed_at: now
        }
      });
      await tx.assessmentSession.update({
        where: { id: cycle.assessment_session_db_id },
        data: {
          current_phase: "followup_stopped",
          last_activity_at: now,
          needs_review: true,
          needs_review_reason: `followup_final_update_failed:${input.failure_category}`,
          automation_exception_reason: `followup_final_update_failed:${input.failure_category}`
        }
      });
    } else {
      await tx.assessmentSession.update({
        where: { id: cycle.assessment_session_db_id },
        data: {
          current_phase: "followup_active",
          last_activity_at: now,
          needs_review: true,
          needs_review_reason: `followup_update_failed:${input.failure_category}`,
          automation_exception_reason: `followup_update_failed:${input.failure_category}`
        }
      });
    }
  });

  await logUpdateEvent({
    assessment_session_db_id: cycle.assessment_session_db_id,
    concept_unit_session_db_id: cycle.concept_unit_session_db_id,
    event_type: stopAfterCycle ? "followup_final_update_failed" : "followup_update_cycle_failed",
    payload: {
      cycle_public_id: cycle.cycle_public_id,
      failure_stage: input.failure_stage,
      failure_category: input.failure_category
    }
  });

  if (cycle.post_cycle_action !== "none") {
    await enqueuePostCycleProgressionFinalizeJob({
      progression_record_db_id: cycle.progression_record_db_id,
      cycle_public_id: cycle.cycle_public_id,
      cycle_db_id: cycle.id,
      assessment_session_db_id: cycle.assessment_session_db_id,
      concept_unit_session_db_id: cycle.concept_unit_session_db_id
    });
  }

  return { status: "cycle_failed" as const, cycle_public_id: cycle.cycle_public_id };
}

export async function markFollowupUpdateCycleFailedFromJob(input: {
  job_payload: unknown;
  job_type: string;
  error_category: string;
  error_message: string;
}) {
  const payload = asRecord(input.job_payload);
  const cyclePublicId = typeof payload.cycle_public_id === "string"
    ? payload.cycle_public_id
    : null;

  if (!cyclePublicId) {
    return null;
  }

  return markFollowupUpdateCycleFailed({
    cycle_public_id: cyclePublicId,
    failure_stage: input.job_type,
    failure_category: input.error_category,
    failure_message: input.error_message
  });
}

export async function requestProgressionFinalUpdate(input: {
  concept_unit_session_db_id: string;
  progression_record_db_id: string;
  progression_public_id: string;
  post_cycle_action: FollowupUpdatePostCycleAction;
}) {
  const activeRound = await prisma.followupRound.findFirst({
    where: {
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      status: "active"
    },
    orderBy: [{ round_index: "desc" }]
  });

  if (!activeRound) {
    return { status: "no_active_round" as const };
  }

  const cutoff = await latestStudentTurn(activeRound.id);
  const { cycle, created } = await createCycle({
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    trigger_type: "student_progression_final_update",
    trigger_details: {
      source: "student_concept_progression",
      progression_public_id: input.progression_public_id
    },
    final_update: true,
    create_next_round: false,
    stop_after_cycle: true,
    post_cycle_action: input.post_cycle_action,
    progression_record_db_id: input.progression_record_db_id,
    evidence_cutoff_turn_db_id: cutoff?.id ?? null
  });

  if (created) {
    await enqueueFollowupProfileUpdateJob(cycle.cycle_public_id);
  }

  return {
    status: created ? "final_update_enqueued" : "final_update_already_active",
    cycle_public_id: cycle.cycle_public_id
  };
}

export async function requestStopFollowupWithPossibleFinalUpdate(input: {
  concept_unit_session_db_id: string;
}) {
  const existing = await activeCycle(input.concept_unit_session_db_id);

  if (existing) {
    const updated = await prisma.followupUpdateCycle.update({
      where: { id: existing.id },
      data: {
        final_update: true,
        create_next_round: false,
        stop_after_cycle: true,
        trigger_details: json({
          ...asRecord(existing.trigger_details),
          stop_requested_during_active_cycle: true
        })
      }
    });

    return {
      status: "stop_after_active_cycle" as const,
      cycle_public_id: updated.cycle_public_id
    };
  }

  const activeRound = await prisma.followupRound.findFirst({
    where: {
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      status: "active"
    },
    orderBy: [{ round_index: "desc" }]
  });

  if (!activeRound) {
    return { status: "no_active_round" as const };
  }

  const substantiveTurnCount = await countSubstantiveAssistantClassifications({
    followup_round_db_id: activeRound.id
  });

  if (substantiveTurnCount === 0) {
    return { status: "no_unprocessed_substantive_evidence" as const };
  }

  const cutoff = await latestStudentTurn(activeRound.id);
  const { cycle, created } = await createCycle({
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    trigger_type: "student_stop_final_update",
    trigger_details: {
      source: "student_stop_followup",
      substantive_turn_count_since_last_update: substantiveTurnCount
    },
    final_update: true,
    create_next_round: false,
    stop_after_cycle: true,
    evidence_cutoff_turn_db_id: cutoff?.id ?? null
  });

  if (created) {
    await enqueueFollowupProfileUpdateJob(cycle.cycle_public_id);
  }

  return {
    status: created ? "final_update_enqueued" : "stop_after_active_cycle",
    cycle_public_id: cycle.cycle_public_id
  };
}

export function serializeFollowupUpdateCycleForTeacher(cycle: {
  cycle_public_id: string;
  trigger_type: string;
  trigger_details: unknown;
  status: string;
  final_update: boolean;
  create_next_round: boolean;
  stop_after_cycle: boolean;
  evidence_cutoff_at: Date | null;
  profile_agent_call_db_id: string | null;
  planning_agent_call_db_id: string | null;
  opening_agent_call_db_id: string | null;
  staged_profile_output: unknown;
  staged_planning_output: unknown;
  staged_opening_output: unknown;
  failure_stage: string | null;
  failure_category: string | null;
  failure_message: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}) {
  return {
    cycle_public_id: cycle.cycle_public_id,
    trigger_type: FollowupUpdateTriggerTypeSchema.safeParse(cycle.trigger_type).success
      ? cycle.trigger_type
      : "unknown",
    trigger_details: safePayload(cycle.trigger_details),
    status: cycle.status,
    final_update: cycle.final_update,
    create_next_round: cycle.create_next_round,
    stop_after_cycle: cycle.stop_after_cycle,
    evidence_cutoff_at: serializeDate(cycle.evidence_cutoff_at),
    stage: cycle.status,
    profile_agent_call_present: Boolean(cycle.profile_agent_call_db_id),
    planning_agent_call_present: Boolean(cycle.planning_agent_call_db_id),
    opening_agent_call_present: Boolean(cycle.opening_agent_call_db_id),
    staged_profile_present: Boolean(cycle.staged_profile_output),
    staged_planning_present: Boolean(cycle.staged_planning_output),
    staged_opening_present: Boolean(cycle.staged_opening_output),
    active_pointers_changed: cycle.status === "completed",
    failure_stage: cycle.failure_stage,
    failure_category: cycle.failure_category,
    failure_message: cycle.failure_message,
    created_at: serializeDate(cycle.created_at),
    updated_at: serializeDate(cycle.updated_at),
    completed_at: serializeDate(cycle.completed_at),
    interpretation_boundary:
      "Failed staged outputs are not active student profiles or formative decisions."
  };
}
