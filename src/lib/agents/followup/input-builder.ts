import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { AgentInputByName } from "@/lib/agents/contracts";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import { aggregateProcessEventsByConceptUnitSession } from "@/lib/services/process-events";
import { stripInternalKeys } from "@/lib/services/teacher-review/serializers";
import {
  getFollowupContextConfig,
  truncateForFollowupProvider,
  type FollowupContextConfig
} from "./context";

export type FollowupInput = AgentInputByName["followup_agent"];

export type BuiltFollowupInput = {
  input: FollowupInput;
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  followup_round_db_id: string;
  agent_invocation_key: string;
  current_formative_value: string;
  config: FollowupContextConfig;
};

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

function safeJson(value: unknown) {
  return stripFollowupAuditKeys(stripInternalKeys(value));
}

function isoDate(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function stableInvocationKey(parts: Array<string | null | undefined>) {
  const hash = createHash("sha256").update(parts.map((part) => part ?? "").join("|")).digest("hex");

  return `followup_${hash}`;
}

function assertNoProhibitedInputFields(value: unknown, path = "input") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoProhibitedInputFields(entry, `${path}.${index}`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase();

    if (
      key === "id" ||
      key.endsWith("_db_id") ||
      key.endsWith("_db_ids") ||
      key === "agent_call_id" ||
      normalized.includes("password") ||
      normalized.includes("access_code") ||
      normalized.includes("cookie") ||
      normalized.includes("authorization") ||
      normalized.includes("api_key") ||
      normalized.includes("database_url") ||
      normalized.includes("session_secret") ||
      normalized.includes("token") ||
      normalized.includes("summative")
    ) {
      throw new Error(`Prohibited follow-up input field at ${path}.${key}`);
    }

    assertNoProhibitedInputFields(entry, `${path}.${key}`);
  }
}

function boundedTranscript(
  turns: Array<{
    actor_type: string;
    agent_name: string | null;
    message_text: string | null;
    structured_payload: unknown;
    created_at: Date;
  }>,
  config: FollowupContextConfig
) {
  const recent = turns.slice(-config.max_turns);
  let remainingChars = config.context_max_chars;
  const bounded = [];

  for (const turn of recent) {
    const message = truncateForFollowupProvider(turn.message_text ?? "", Math.max(0, remainingChars));
    remainingChars = Math.max(0, remainingChars - message.length);
    bounded.push({
      actor_type: turn.actor_type,
      agent_name: turn.agent_name,
      message_text: message,
      created_at: turn.created_at.toISOString(),
      structured_payload: safeJson(turn.structured_payload)
    });

    if (remainingChars <= 0) {
      break;
    }
  }

  return bounded;
}

export async function buildFollowupInput(input: {
  followup_round_db_id: string;
  turn_type: "opening" | "student_reply";
  student_turn_db_id?: string | null;
}) : Promise<BuiltFollowupInput> {
  const config = getFollowupContextConfig();
  const round = await prisma.followupRound.findUniqueOrThrow({
    where: { id: input.followup_round_db_id },
    include: {
      formative_decision: true,
      concept_unit_session: {
        include: {
          latest_student_profile: true,
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
              user: {
                select: { user_id: true }
              }
            }
          },
          concept_unit: {
            include: {
              items: {
                where: {
                  included_in_published_set: true,
                  status: "published"
                },
                orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
              }
            }
          },
          item_responses: {
            include: {
              item: {
                select: {
                  item_public_id: true,
                  item_order: true
                }
              }
            },
            orderBy: [
              {
                item: {
                  item_order: "asc"
                }
              },
              { created_at: "asc" }
            ]
          }
        }
      },
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
  });
  const conceptUnitSession = round.concept_unit_session;
  const latestProfile = conceptUnitSession.latest_student_profile;

  if (!latestProfile) {
    throw new Error("Latest student profile is required to build follow-up input.");
  }

  const studentTurn = input.student_turn_db_id
    ? await prisma.conversationTurn.findUniqueOrThrow({
        where: { id: input.student_turn_db_id },
        select: {
          id: true,
          message_text: true,
          created_at: true,
          structured_payload: true
        }
      })
    : null;

  const processContext = await aggregateProcessEventsByConceptUnitSession(conceptUnitSession.id);
  const prompt = getPromptForAgent("followup_agent");
  const transcript = boundedTranscript(round.conversation_turns, config);
  const inputObject: FollowupInput = {
    turn_type: input.turn_type,
    latest_student_profile: {
      profile_type: latestProfile.profile_type,
      ability_profile: latestProfile.ability_profile,
      ability_pattern_flags: safeJson(latestProfile.ability_pattern_flags),
      engagement_profile: latestProfile.engagement_profile,
      engagement_pattern_flags: safeJson(latestProfile.engagement_pattern_flags),
      integrated_diagnostic_profile: latestProfile.integrated_diagnostic_profile,
      integrated_profile_confidence: latestProfile.integrated_profile_confidence,
      integrated_profile_rationale: latestProfile.integrated_profile_rationale,
      evidence_sufficiency: latestProfile.evidence_sufficiency,
      confidence_alignment: latestProfile.confidence_alignment,
      independence_interpretability: latestProfile.independence_interpretability,
      misconception_indicators: safeJson(latestProfile.misconception_indicators),
      item_level_evidence: safeJson(latestProfile.item_level_evidence),
      reasoning_quality_summary: latestProfile.reasoning_quality_summary,
      engagement_summary: latestProfile.engagement_summary,
      process_interpretation_cautions: safeJson(latestProfile.process_interpretation_cautions),
      profile_confidence: latestProfile.profile_confidence,
      rationale: latestProfile.rationale,
      recommended_next_evidence: safeJson(latestProfile.recommended_next_evidence),
      created_at: latestProfile.created_at.toISOString()
    },
    latest_formative_decision: {
      formative_value: round.formative_decision.formative_value,
      formative_action_plan: round.formative_decision.formative_action_plan,
      target_evidence: safeJson(round.formative_decision.target_evidence),
      success_criteria: safeJson(round.formative_decision.success_criteria),
      followup_prompt_constraints: safeJson(round.formative_decision.followup_prompt_constraints),
      profile_update_triggers: safeJson(round.formative_decision.profile_update_triggers),
      rationale: round.formative_decision.rationale,
      created_at: round.formative_decision.created_at.toISOString()
    },
    formative_action_plan: round.formative_decision.formative_action_plan,
    target_evidence: Array.isArray(round.formative_decision.target_evidence)
      ? round.formative_decision.target_evidence.filter((entry): entry is string => typeof entry === "string")
      : [],
    success_criteria: Array.isArray(round.formative_decision.success_criteria)
      ? round.formative_decision.success_criteria.filter((entry): entry is string => typeof entry === "string")
      : [],
    followup_prompt_constraints: Array.isArray(round.formative_decision.followup_prompt_constraints)
      ? round.formative_decision.followup_prompt_constraints.filter((entry): entry is string => typeof entry === "string")
      : [],
    current_followup_round: {
      round_index: round.round_index,
      status: round.status,
      started_at: isoDate(round.started_at),
      completed_at: isoDate(round.completed_at)
    },
    recent_followup_transcript: transcript,
    student_message: studentTurn
      ? truncateForFollowupProvider(studentTurn.message_text ?? "", config.message_max_chars)
      : null,
    concept_unit_metadata: {
      assessment: safeJson(conceptUnitSession.assessment_session.assessment),
      assessment_session: {
        session_public_id: conceptUnitSession.assessment_session.session_public_id,
        current_phase: conceptUnitSession.assessment_session.current_phase,
        attempt_number: conceptUnitSession.assessment_session.attempt_number
      },
      student: {
        user_id: conceptUnitSession.assessment_session.user.user_id
      },
      concept_unit: {
        concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
        title: conceptUnitSession.concept_unit.title,
        learning_objective: conceptUnitSession.concept_unit.learning_objective,
        related_concept_description: conceptUnitSession.concept_unit.related_concept_description,
        order_index: conceptUnitSession.concept_unit.order_index,
        version: conceptUnitSession.concept_unit.version
      }
    },
    relevant_item_evidence: conceptUnitSession.item_responses.map((response) => ({
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
      item_snapshot: safeJson(response.item_snapshot),
      item_version_snapshot: response.item_version_snapshot
    })),
    process_context: {
      aggregate_counts: safeJson(processContext),
      interpretation_boundary:
        "Process data are contextual evidence for engagement and evidence sufficiency, not misconduct evidence."
    },
    followup_constraints: {
      no_profile_update_in_phase6d1: true,
      no_replanning_in_phase6d1: true,
      no_initial_response_overwrite: true,
      no_student_profile_labels: true,
      no_formative_value_label_to_student: true,
      context_window: {
        sent_recent_turn_count: transcript.length,
        max_turns: config.max_turns,
        context_max_chars: config.context_max_chars,
        full_transcript_stored_in_database: true
      },
      prompt_schema_version: prompt.schema_version
    }
  };

  assertNoProhibitedInputFields(inputObject);

  return {
    input: inputObject,
    assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
    concept_unit_session_db_id: conceptUnitSession.id,
    followup_round_db_id: round.id,
    agent_invocation_key: stableInvocationKey([
      conceptUnitSession.id,
      round.id,
      input.turn_type,
      studentTurn?.id ?? "opening",
      "followup_agent",
      prompt.prompt_version,
      prompt.schema_version,
      prompt.prompt_hash
    ]),
    current_formative_value: round.formative_decision.formative_value,
    config
  };
}
