import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  parseCanonicalMisconceptionClaimCatalog
} from "../src/lib/domain/misconception-claim-identity";
import {
  runInitialStudentProfiling,
  StudentProfilingServiceError
} from "../src/lib/agents/student-profiling/service";
import { createResponsePackage } from "../src/lib/services/response-packages";
import {
  buildFormativeConversationRuntimeContextSeedForInternalOpening,
  createOrGetFormativeConversationSession,
  ensureFormativeConversationOpeningForConversation
} from "../src/lib/services/student-assessment/formative-conversation";
import {
  cleanupResponseCollectionFixture,
  createResponseCollectionFixture
} from "./response-collection-smoke-fixture";

const prisma = new PrismaClient();

process.env.LLM_PROVIDER = "mock";
process.env.LLM_LIVE_CALLS_ENABLED = "false";
process.env.OPERATIONAL_AGENT_MODE = "mock";
process.env.FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED = "false";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY_FILE;

async function createLegacyProfileConversation(prefix: string) {
  const fixture = await createResponseCollectionFixture({
    prisma,
    prefix,
    responseCollectionMode: "deterministic"
  });
  const completedAt = new Date("2026-08-28T05:00:00.000Z");
  await prisma.conceptUnitSession.update({
    where: { id: fixture.conceptUnitSession.id },
    data: {
      status: "initial_completed",
      initial_completed_at: completedAt
    }
  });
  await prisma.assessmentSession.update({
    where: { id: fixture.session.id },
    data: { current_phase: "planning_completed" }
  });

  for (const [index, item] of fixture.items.entries()) {
    await prisma.itemResponse.create({
      data: {
        concept_unit_session_db_id: fixture.conceptUnitSession.id,
        item_db_id: item.id,
        selected_option: index === 0 ? "B" : "A",
        correct_option_snapshot: "A",
        correctness: index === 0 ? "incorrect" : "correct",
        reasoning_text:
          index === 0
            ? "Consistency by itself proves the interpretation is valid."
            : "The response uses the evidence described in the item.",
        confidence_rating: index === 0 ? "high" : "medium",
        item_started_at: new Date(completedAt.getTime() - 60_000),
        item_submitted_at: completedAt,
        answer_explanation_revealed: true,
        revealed_at: completedAt,
        reveal_trigger: "initial_package_review",
        item_version_snapshot: item.version,
        item_snapshot: {
          item_public_id: item.item_public_id,
          item_stem: item.item_stem,
          options: item.options,
          expected_reasoning_patterns: item.expected_reasoning_patterns
        }
      }
    });
  }
  await createResponsePackage({
    concept_unit_session_db_id: fixture.conceptUnitSession.id,
    package_type: "initial_concept_unit_response_package"
  });

  const legacyProfile = await prisma.studentProfile.create({
    data: {
      concept_unit_session_db_id: fixture.conceptUnitSession.id,
      profile_type: "initial",
      ability_profile: "misconception_based_understanding",
      ability_pattern_flags: ["misconception_indicator_present"],
      engagement_profile: "adequate_engagement",
      engagement_pattern_flags: ["no_clear_pattern"],
      integrated_diagnostic_profile:
        "misconception_with_sufficient_engagement",
      integrated_profile_confidence: "medium",
      integrated_profile_rationale:
        "Legacy profile used by the empty-conversation repair regression.",
      evidence_sufficiency: "adequate",
      confidence_alignment: "overconfident",
      independence_interpretability: "not_applicable",
      misconception_indicators: [
        {
          proposition: "Consistency proves validity.",
          present: true,
          evidence_refs: [fixture.items[0].item_public_id]
        }
      ],
      item_level_evidence: [],
      reasoning_quality_summary:
        "The response uses a legacy misconception representation.",
      engagement_summary: "The initial package was completed.",
      process_interpretation_cautions: [],
      profile_confidence: "medium",
      rationale: "Legacy handoff fixture.",
      recommended_next_evidence: []
    }
  });
  await prisma.conceptUnitSession.update({
    where: { id: fixture.conceptUnitSession.id },
    data: { latest_student_profile_db_id: legacyProfile.id }
  });
  const conversation = await createOrGetFormativeConversationSession({
    assessment_session_db_id: fixture.session.id,
    concept_unit_session_db_id: fixture.conceptUnitSession.id,
    initial_student_profile_db_id: legacyProfile.id,
    current_student_profile_db_id: legacyProfile.id
  });

  return {
    fixture,
    legacyProfile,
    conversation: conversation.session
  };
}

async function cleanup(prefix: string) {
  await prisma.formativeConversationSession.deleteMany({
    where: {
      assessment_session: {
        assessment: { title: { startsWith: prefix } }
      }
    }
  });
  await cleanupResponseCollectionFixture(prisma, prefix);
}

async function main() {
  const prefix = `profile_handoff_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const blockedPrefix = `${prefix}_blocked`;
  await cleanup(prefix);

  try {
    const repair = await createLegacyProfileConversation(prefix);
    const opening = await ensureFormativeConversationOpeningForConversation({
      conversation_public_id: repair.conversation.conversation_public_id,
      execution_mode: "deterministic_e1"
    });
    assert.equal(opening.status, "created");
    assert(opening.opening?.tutor_turn.id);

    const repairedConversation =
      await prisma.formativeConversationSession.findUniqueOrThrow({
        where: { id: repair.conversation.id },
        include: {
          initial_student_profile: true,
          current_student_profile: true
        }
      });
    assert.notEqual(
      repairedConversation.initial_student_profile_db_id,
      repair.legacyProfile.id,
      "The empty conversation should no longer point at the legacy profile."
    );
    assert.equal(
      repairedConversation.current_student_profile_db_id,
      repairedConversation.initial_student_profile_db_id
    );
    assert(
      parseCanonicalMisconceptionClaimCatalog(
        repairedConversation.initial_student_profile
          ?.misconception_indicators
      ),
      "The replacement initial profile must contain the canonical claim catalog."
    );
    const conceptUnitSession =
      await prisma.conceptUnitSession.findUniqueOrThrow({
        where: { id: repair.fixture.conceptUnitSession.id }
      });
    assert.equal(
      conceptUnitSession.latest_student_profile_db_id,
      repairedConversation.initial_student_profile_db_id,
      "The concept-unit latest profile should follow the canonical conversation profile."
    );
    const seed =
      await buildFormativeConversationRuntimeContextSeedForInternalOpening({
        conversation_public_id:
          repairedConversation.conversation_public_id
      });
    assert(
      seed.initial_profile.misconception_claim_catalog,
      "Opening context compilation should be reachable after repair."
    );

    const profileCount = await prisma.studentProfile.count({
      where: {
        concept_unit_session_db_id: repair.fixture.conceptUnitSession.id
      }
    });
    const replay = await runInitialStudentProfiling({
      concept_unit_session_db_id: repair.fixture.conceptUnitSession.id,
      invocation_reason: "profile_handoff_empty_conversation_replay",
      repair_empty_formative_conversation: true
    });
    assert.equal(replay.status, "already_profiled");
    assert.equal(
      await prisma.studentProfile.count({
        where: {
          concept_unit_session_db_id:
            repair.fixture.conceptUnitSession.id
        }
      }),
      profileCount,
      "A repeated repair must not create another profile."
    );
    const openingReplay =
      await ensureFormativeConversationOpeningForConversation({
        conversation_public_id:
          repair.conversation.conversation_public_id,
        execution_mode: "deterministic_e1"
      });
    assert.equal(openingReplay.status, "existing_transcript");
    assert.equal(
      await prisma.conversationTurn.count({
        where: {
          formative_conversation_session_db_id: repair.conversation.id,
          actor_type: "agent",
          agent_name: "formative_conversation_agent"
        }
      }),
      1,
      "Retrying after the opening exists must not duplicate the tutor turn."
    );

    const blocked = await createLegacyProfileConversation(blockedPrefix);
    await prisma.conversationTurn.create({
      data: {
        assessment_session_db_id: blocked.fixture.session.id,
        concept_unit_session_db_id:
          blocked.fixture.conceptUnitSession.id,
        formative_conversation_session_db_id: blocked.conversation.id,
        phase: "planning_completed",
        actor_type: "student",
        message_text: "This existing student turn must remain immutable.",
        structured_payload: {
          visibility: "student_visible",
          message_type: "formative_conversation_student_message"
        }
      }
    });
    await assert.rejects(
      runInitialStudentProfiling({
        concept_unit_session_db_id:
          blocked.fixture.conceptUnitSession.id,
        invocation_reason: "profile_handoff_nonempty_repair_blocked",
        repair_empty_formative_conversation: true
      }),
      (error: unknown) =>
        error instanceof StudentProfilingServiceError &&
        error.code === "formative_conversation_profile_repair_blocked"
    );
    const blockedConversation =
      await prisma.formativeConversationSession.findUniqueOrThrow({
        where: { id: blocked.conversation.id }
      });
    assert.equal(
      blockedConversation.initial_student_profile_db_id,
      blocked.legacyProfile.id,
      "A nonempty conversation must retain its original profile binding."
    );

    assert.equal(
      await prisma.agentCall.count({
        where: {
          assessment_session_db_id: {
            in: [
              repair.fixture.session.id,
              blocked.fixture.session.id
            ]
          },
          provider: "openai"
        }
      }),
      0,
      "The profile handoff smoke must make no OpenAI provider calls."
    );
    assert.equal(
      await prisma.agentCall.count({
        where: {
          assessment_session_db_id: repair.fixture.session.id,
          agent_name: "student_profiling_agent"
        }
      }),
      0,
      "A deterministic execution mode must not attempt the profiling provider."
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          empty_conversation_rebound: true,
          canonical_context_compiled: true,
          opening_created: true,
          idempotent_replay: true,
          nonempty_conversation_rebind_blocked: true,
          provider_calls: 0
        },
        null,
        2
      )
    );
  } finally {
    await cleanup(prefix);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
