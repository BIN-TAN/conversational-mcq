import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
  FormativeConversationAgentInputSchema,
  type FormativeConversationAdministeredItem,
  type FormativeConversationAgentInput,
  type FormativeConversationProfileEvidence
} from "./agent-contract";
import { validateFormativeConversationSafetyBoundary } from "./safety-boundary";

function asObject(value: unknown): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

export function formativeConversationTranscriptHash(
  turns: FormativeConversationAgentInput["visible_transcript"]
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        turns.map((turn) => ({
          sequence_index: turn.sequence_index,
          actor: turn.actor,
          message_text: turn.message_text
        }))
      )
    )
    .digest("hex");
}

export function compileFormativeConversationContext(
  input: Omit<
    FormativeConversationAgentInput,
    | "contract_version"
    | "context_version"
    | "safety_boundary"
    | "profile_history"
    | "telemetry_summary"
    | "teacher_guidance"
  > &
    Partial<
      Pick<
        FormativeConversationAgentInput,
        "profile_history" | "telemetry_summary" | "teacher_guidance"
      >
    > & {
    authorized_administered_item_public_ids: string[];
  }
) {
  const {
    authorized_administered_item_public_ids: authorizedAdministeredItemPublicIds,
    ...agentInput
  } = input;
  const parsed = FormativeConversationAgentInputSchema.parse({
    ...agentInput,
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    context_version: FORMATIVE_CONVERSATION_CONTEXT_VERSION,
    visible_transcript: [...agentInput.visible_transcript].sort(
      (left, right) => left.sequence_index - right.sequence_index
    ),
    safety_boundary: {
      boundary_version: FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
      administered_item_public_ids: [...authorizedAdministeredItemPublicIds].sort(),
      unadministered_item_protection_required: true,
      hidden_prompts_excluded: true,
      raw_teacher_notes_excluded: true,
      credentials_excluded: true
    }
  });
  const safety = validateFormativeConversationSafetyBoundary(parsed);

  if (!safety.valid) {
    throw new Error(`formative_conversation_context_unsafe:${safety.issue_codes.join(",")}`);
  }

  return {
    context: parsed,
    safety
  };
}

export async function compilePersistedFormativeConversationContext(input: {
  conversation_public_id: string;
  assessment_public_id: string;
  concept_unit_public_id: string;
  administered_items: FormativeConversationAdministeredItem[];
  initial_profile: FormativeConversationProfileEvidence;
  current_profile: FormativeConversationProfileEvidence;
}) {
  const session = await prisma.formativeConversationSession.findUniqueOrThrow({
    where: { conversation_public_id: input.conversation_public_id },
    include: {
      conversation_turns: {
        where: {
          message_text: { not: null },
          actor_type: { in: ["student", "agent"] }
        },
        orderBy: { sequence_index: "asc" }
      },
      interventions: {
        orderBy: { created_at: "asc" }
      },
      memory_snapshots: {
        orderBy: { snapshot_index: "desc" },
        take: 1
      },
      concept_unit_session: {
        select: {
          student_profiles: {
            orderBy: { created_at: "asc" },
            select: {
              id: true,
              integrated_diagnostic_profile: true,
              created_at: true,
              based_on_agent_call: {
                select: {
                  agent_name: true
                }
              }
            }
          },
          item_responses: {
            where: {
              OR: [
                { item_started_at: { not: null } },
                { item_submitted_at: { not: null } }
              ]
            },
            select: {
              item: {
                select: { item_public_id: true }
              }
            }
          }
        }
      },
      lifecycle_events: {
        select: {
          occurred_at: true
        }
      },
      turn_telemetry: {
        select: {
          input_token_count: true,
          output_token_count: true
        }
      }
    }
  });
  const visibleTranscript = session.conversation_turns.flatMap((turn) =>
    turn.message_text &&
    asObject(turn.structured_payload).visibility === "student_visible"
      ? [
          {
            sequence_index: turn.sequence_index,
            actor: turn.actor_type === "student" ? ("student" as const) : ("tutor" as const),
            message_text: turn.message_text,
            created_at: turn.created_at.toISOString()
          }
        ]
      : []
  );
  const latestStudentMessage =
    [...visibleTranscript].reverse().find((turn) => turn.actor === "student")?.message_text ??
    null;
  const memory = session.memory_snapshots[0];
  const profileOutcome = (value: string) =>
    value === "robust_understanding_ready_for_transfer"
      ? ("sound_understanding" as const)
      : ("not_yet_determined" as const);

  return compileFormativeConversationContext({
    conversation_public_id: session.conversation_public_id,
    assessment_public_id: input.assessment_public_id,
    concept_unit_public_id: input.concept_unit_public_id,
    latest_student_message: latestStudentMessage,
    visible_transcript: visibleTranscript,
    administered_items: input.administered_items,
    initial_profile: input.initial_profile,
    current_profile: input.current_profile,
    profile_history: session.concept_unit_session.student_profiles.map(
      (profile) => ({
        profile_version: profile.id,
        outcome: profileOutcome(profile.integrated_diagnostic_profile),
        created_at: profile.created_at.toISOString(),
        evidence_source:
          profile.based_on_agent_call?.agent_name ?? "assessment_profile"
      })
    ),
    telemetry_summary: {
      observable_student_turn_count: visibleTranscript.filter(
        (turn) => turn.actor === "student"
      ).length,
      observable_tutor_turn_count: visibleTranscript.filter(
        (turn) => turn.actor === "tutor"
      ).length,
      lifecycle_event_count: session.lifecycle_events.length,
      latest_activity_at:
        session.lifecycle_events
          .map((event) => event.occurred_at)
          .sort((left, right) => right.getTime() - left.getTime())[0]
          ?.toISOString() ?? null,
      total_input_tokens: session.turn_telemetry.reduce(
        (sum, entry) => sum + (entry.input_token_count ?? 0),
        0
      ),
      total_output_tokens: session.turn_telemetry.reduce(
        (sum, entry) => sum + (entry.output_token_count ?? 0),
        0
      )
    },
    teacher_guidance: [],
    intervention_history: session.interventions.map((intervention) => ({
      intervention_public_id: intervention.intervention_public_id,
      strategy_type: intervention.strategy_type,
      targeted_evidence_gap: intervention.targeted_evidence_gap,
      status: intervention.status,
      outcome_summary: Object.values(asObject(intervention.outcome_evidence)).filter(
        (value): value is string => typeof value === "string" && value.length > 0
      )
    })),
    memory: memory
      ? {
          snapshot_public_id: memory.snapshot_public_id,
          snapshot_index: memory.snapshot_index,
          schema_version: memory.schema_version,
          source_transcript_hash: memory.source_transcript_hash,
          summary: asObject(memory.summary_payload)
        }
      : null,
    authorized_administered_item_public_ids:
      session.concept_unit_session.item_responses.map(
        (response) => response.item.item_public_id
      )
  });
}
