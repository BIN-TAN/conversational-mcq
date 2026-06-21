import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { AgentInputByName } from "@/lib/agents/contracts";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import { stripInternalKeys } from "@/lib/services/teacher-review/serializers";
import {
  defaultFormativeValueForIntegratedProfile,
  planningMappingForPrompt
} from "./mapping";

export type FormativePlanningInput = AgentInputByName["formative_value_and_planning_agent"];

export type BuiltFormativePlanningInput = {
  input: FormativePlanningInput;
  response_package: {
    id: string;
    package_type: string;
    created_at: Date;
  };
  student_profile: {
    id: string;
    created_at: Date;
    integrated_diagnostic_profile: string;
  };
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  agent_invocation_key: string;
  default_formative_value: string;
};

const prohibitedKeyFragments = [
  "password",
  "access_code",
  "cookie",
  "authorization",
  "api_key",
  "database_url",
  "session_secret",
  "token",
  "summative"
];

function isoDate(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function safeJson(value: unknown) {
  return stripInternalKeys(value);
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
    const prohibited = prohibitedKeyFragments.some((fragment) => normalized.includes(fragment));

    if (prohibited || key.endsWith("_db_id") || key.endsWith("_db_ids") || key === "id") {
      throw new Error(`Prohibited planning input field at ${path}.${key}`);
    }

    assertNoProhibitedInputFields(entry, `${path}.${key}`);
  }
}

function stableInvocationKey(parts: Array<string | null | undefined>) {
  const hash = createHash("sha256").update(parts.map((part) => part ?? "").join("|")).digest("hex");

  return `formative_planning_initial_${hash}`;
}

export async function buildInitialFormativePlanningInput(
  conceptUnitSessionDbId: string
): Promise<BuiltFormativePlanningInput> {
  const conceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: conceptUnitSessionDbId },
    include: {
      assessment_session: {
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
              user_id: true
            }
          },
          assessment: {
            select: {
              assessment_public_id: true,
              title: true,
              description: true,
              status: true
            }
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
      latest_student_profile: true
    }
  });

  if (!conceptUnitSession.latest_student_profile) {
    throw new Error("Latest student profile is required to build planning input.");
  }

  if (
    conceptUnitSession.latest_student_profile.concept_unit_session_db_id !==
    conceptUnitSession.id
  ) {
    throw new Error("Latest student profile does not belong to this concept-unit session.");
  }

  const responsePackage = await prisma.responsePackage.findFirstOrThrow({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      package_type: "initial_concept_unit_response_package"
    },
    orderBy: [{ created_at: "desc" }],
    select: {
      id: true,
      package_type: true,
      payload: true,
      created_at: true
    }
  });
  const previousDecisions = await prisma.formativeDecision.findMany({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id
    },
    orderBy: [{ created_at: "asc" }],
    include: {
      based_on_agent_call: {
        select: {
          provider: true,
          model_name: true,
          prompt_version: true,
          schema_version: true,
          prompt_hash: true,
          call_status: true,
          output_validated: true,
          created_at: true,
          completed_at: true
        }
      }
    }
  });
  const latestProfile = conceptUnitSession.latest_student_profile;
  const defaultFormativeValue = defaultFormativeValueForIntegratedProfile(
    latestProfile.integrated_diagnostic_profile
  );
  const prompt = getPromptForAgent("formative_value_and_planning_agent");
  const input: FormativePlanningInput = {
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
      process_interpretation_cautions: safeJson(
        latestProfile.process_interpretation_cautions
      ),
      profile_confidence: latestProfile.profile_confidence,
      rationale: latestProfile.rationale,
      recommended_next_evidence: safeJson(latestProfile.recommended_next_evidence),
      created_at: latestProfile.created_at.toISOString()
    },
    response_package: {
      package_type: responsePackage.package_type,
      created_at: responsePackage.created_at.toISOString(),
      payload: safeJson(responsePackage.payload)
    },
    concept_unit_metadata: {
      assessment: {
        assessment_public_id:
          conceptUnitSession.assessment_session.assessment.assessment_public_id,
        title: conceptUnitSession.assessment_session.assessment.title,
        description: conceptUnitSession.assessment_session.assessment.description,
        status: conceptUnitSession.assessment_session.assessment.status
      },
      assessment_session: {
        session_public_id: conceptUnitSession.assessment_session.session_public_id,
        attempt_number: conceptUnitSession.assessment_session.attempt_number,
        status: conceptUnitSession.assessment_session.status,
        current_phase: conceptUnitSession.assessment_session.current_phase,
        started_at: isoDate(conceptUnitSession.assessment_session.started_at),
        last_activity_at: isoDate(conceptUnitSession.assessment_session.last_activity_at),
        completed_at: isoDate(conceptUnitSession.assessment_session.completed_at)
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
        administration_rules: safeJson(conceptUnitSession.concept_unit.administration_rules),
        order_index: conceptUnitSession.concept_unit.order_index,
        version: conceptUnitSession.concept_unit.version
      },
      administered_items: conceptUnitSession.concept_unit.items.map((item) => ({
        item_public_id: item.item_public_id,
        item_order: item.item_order,
        item_stem: item.item_stem,
        options: safeJson(item.options),
        correct_option: item.correct_option,
        distractor_rationales: safeJson(item.distractor_rationales),
        expected_reasoning_patterns: safeJson(item.expected_reasoning_patterns),
        possible_misconception_indicators: safeJson(
          item.possible_misconception_indicators
        ),
        version: item.version
      }))
    },
    previous_formative_decisions: previousDecisions.map((decision) => ({
      formative_value: decision.formative_value,
      formative_action_plan: decision.formative_action_plan,
      target_evidence: safeJson(decision.target_evidence),
      success_criteria: safeJson(decision.success_criteria),
      followup_prompt_constraints: safeJson(decision.followup_prompt_constraints),
      profile_update_triggers: safeJson(decision.profile_update_triggers),
      rationale: decision.rationale,
      mapping_followed: decision.mapping_followed,
      mapping_deviation_reason: decision.mapping_deviation_reason,
      created_at: decision.created_at.toISOString(),
      based_on_agent_call: decision.based_on_agent_call
        ? {
            provider: decision.based_on_agent_call.provider,
            model_name: decision.based_on_agent_call.model_name,
            prompt_version: decision.based_on_agent_call.prompt_version,
            schema_version: decision.based_on_agent_call.schema_version,
            prompt_hash: decision.based_on_agent_call.prompt_hash,
            call_status: decision.based_on_agent_call.call_status,
            output_validated: decision.based_on_agent_call.output_validated,
            created_at: isoDate(decision.based_on_agent_call.created_at),
            completed_at: isoDate(decision.based_on_agent_call.completed_at)
          }
        : null
    })),
    allowed_formative_values: [
      "diagnostic_clarification",
      "reasoning_refinement",
      "confidence_calibration",
      "independent_understanding_verification",
      "consolidation_or_transfer"
    ],
    planning_constraints: {
      default_mapping: planningMappingForPrompt(),
      default_formative_value: defaultFormativeValue,
      mapping_rule:
        "Treat the default mapping as a strong guide. Any deviation requires mapping_followed=false and a substantive mapping_deviation_reason.",
      scope:
        "Create only a future Follow-up Agent plan. Do not deliver activity, create follow-up rounds, update the profile, or communicate with the student.",
      prohibited_claims: [
        "cheating",
        "confirmed GenAI use",
        "misconduct",
        "dishonesty",
        "stable low motivation trait",
        "clinical or psychological condition"
      ],
      process_data_boundary:
        "Process data are contextual evidence for engagement and evidence sufficiency, not misconduct evidence.",
      output_schema_version: prompt.schema_version
    }
  };

  assertNoProhibitedInputFields(input);

  return {
    input,
    response_package: responsePackage,
    student_profile: {
      id: latestProfile.id,
      created_at: latestProfile.created_at,
      integrated_diagnostic_profile: latestProfile.integrated_diagnostic_profile
    },
    assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
    concept_unit_session_db_id: conceptUnitSession.id,
    agent_invocation_key: stableInvocationKey([
      conceptUnitSession.id,
      latestProfile.id,
      latestProfile.created_at.toISOString(),
      responsePackage.id,
      "formative_value_and_planning_agent",
      prompt.prompt_version,
      prompt.schema_version,
      prompt.prompt_hash
    ]),
    default_formative_value: defaultFormativeValue
  };
}
