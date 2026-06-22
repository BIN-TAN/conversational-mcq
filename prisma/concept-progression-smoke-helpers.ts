import type { PrismaClient } from "@prisma/client";
import { generatePublicId } from "../src/lib/services/ids";
import { startFollowupRoundForTeacher } from "../src/lib/agents/followup/service";
import {
  assert,
  createFollowupSmokeFixture,
  setFollowupSmokeEnv
} from "./followup-smoke-fixture";

export function setPhase6D3SmokeEnv(input: {
  developmentControlsEnabled?: boolean;
  allowManualReviewStarts?: boolean;
} = {}) {
  setFollowupSmokeEnv({
    LLM_PROVIDER: "mock",
    LLM_LIVE_CALLS_ENABLED: "false",
    OPENAI_API_KEY: "",
    LLM_DAILY_STUDENT_CALL_LIMIT: "100",
    LLM_DAILY_STUDENT_TOKEN_LIMIT: "100000",
    LLM_DAILY_CLASS_CALL_LIMIT: "100",
    LLM_DAILY_CLASS_TOKEN_LIMIT: "100000",
    LLM_SESSION_CALL_LIMIT: "100",
    LLM_SESSION_TOKEN_LIMIT: "100000",
    LLM_AGENT_CALL_LIMIT_PER_SESSION: "50",
    LLM_USAGE_TIMEZONE: "UTC",
    FOLLOWUP_CONTEXT_MAX_TURNS: "8",
    FOLLOWUP_MESSAGE_MAX_CHARS: "1200",
    FOLLOWUP_CONTEXT_MAX_CHARS: "10000",
    FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE: "3",
    DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED: input.developmentControlsEnabled
      ? "true"
      : "false",
    ALLOW_MANUAL_REVIEW_STUDENT_STARTS: input.allowManualReviewStarts ? "true" : "false"
  });
}

function itemSeed(itemOrder: number, title: string) {
  return {
    item_order: itemOrder,
    item_stem: `${title} item ${itemOrder}`,
    options: [
      { label: "A", text: "Best-supported answer" },
      { label: "B", text: "Partial answer" },
      { label: "C", text: "Misconception answer" }
    ],
    correct_option: "A",
    distractor_rationales: {
      B: "B reflects partial understanding.",
      C: "C reflects a plausible misconception."
    },
    expected_reasoning_patterns: ["Connects option A to the concept evidence."],
    possible_misconception_indicators: ["Chooses C with reversed reasoning."]
  };
}

export async function addPublishedConceptUnit(input: {
  prisma: PrismaClient;
  assessment_db_id: string;
  order_index: number;
  title: string;
}) {
  const conceptUnit = await input.prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: generatePublicId("concept_unit"),
      assessment_db_id: input.assessment_db_id,
      title: input.title,
      learning_objective: `Learning objective for ${input.title}.`,
      related_concept_description: `Related concept description for ${input.title}.`,
      administration_rules: { no_feedback_during_initial_administration: true },
      order_index: input.order_index,
      status: "published",
      version: 1
    }
  });

  for (const order of [1, 2, 3]) {
    const seed = itemSeed(order, input.title);

    await input.prisma.item.create({
      data: {
        item_public_id: generatePublicId("item"),
        concept_unit_db_id: conceptUnit.id,
        item_order: seed.item_order,
        item_stem: seed.item_stem,
        options: seed.options,
        correct_option: seed.correct_option,
        distractor_rationales: seed.distractor_rationales,
        expected_reasoning_patterns: seed.expected_reasoning_patterns,
        possible_misconception_indicators: seed.possible_misconception_indicators,
        administration_rules: { no_feedback_during_initial_administration: true },
        included_in_published_set: true,
        status: "published",
        version: 1
      }
    });
  }

  return conceptUnit;
}

export async function createReadyFollowupFixture(input: {
  prisma: PrismaClient;
  prefix: string;
  suffix: string;
  extra_concept_count?: number;
}) {
  const fixture = await createFollowupSmokeFixture(input.prisma, {
    prefix: input.prefix,
    suffix: input.suffix,
    withProfile: true,
    withPlanning: true
  });

  const extraConcepts = [];

  for (let index = 0; index < (input.extra_concept_count ?? 0); index += 1) {
    extraConcepts.push(
      await addPublishedConceptUnit({
        prisma: input.prisma,
        assessment_db_id: fixture.assessment.id,
        order_index: index + 2,
        title: `${input.prefix} ${input.suffix} concept ${index + 2}`
      })
    );
  }

  const conceptUnitSession = await input.prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: fixture.conceptUnitSession.id },
    select: {
      latest_student_profile_db_id: true
    }
  });

  assert(
    conceptUnitSession.latest_student_profile_db_id,
    "Ready progression fixture requires an active profile."
  );
  await input.prisma.studentProfile.update({
    where: { id: conceptUnitSession.latest_student_profile_db_id },
    data: {
      integrated_diagnostic_profile: "robust_understanding_ready_for_transfer",
      evidence_sufficiency: "adequate"
    }
  });
  await startFollowupRoundForTeacher({
    session_public_id: fixture.session.session_public_id,
    concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id,
    requested_by_user_db_id: fixture.teacher.id
  });

  return { ...fixture, extraConcepts };
}

export async function assertNoOpenAiCalls(prisma: PrismaClient, assessmentSessionDbId: string) {
  const count = await prisma.agentCall.count({
    where: {
      assessment_session_db_id: assessmentSessionDbId,
      provider: "openai"
    }
  });

  assert(count === 0, "Phase 6D3 smoke tests must not create OpenAI provider calls.");
}
