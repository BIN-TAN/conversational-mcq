import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import {
  completeInitialConceptUnitAdministration,
  getStudentSafeTranscript,
  recordConfidence,
  recordReasoning,
  recordSelectedOption,
  recordTemptingOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup(userDbId: string, sessionPublicIds: string[]) {
  const sessions = await prisma.assessmentSession.findMany({
    where: {
      OR: [{ user_db_id: userDbId }, { session_public_id: { in: sessionPublicIds } }]
    },
    select: { id: true }
  });
  const sessionIds = sessions.map((session) => session.id);
  const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    select: { id: true }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map((session) => session.id);

  await prisma.workflowJob.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.workflowOverride.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.studentActionIdempotencyKey.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.responsePackage.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.processEvent.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.conversationTurn.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.followupRound.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.formativeDecision.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.studentProfile.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.agentCall.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.itemResponse.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.conceptUnitSession.deleteMany({ where: { id: { in: conceptUnitSessionIds } } });
  await prisma.assessmentSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.user.deleteMany({ where: { id: userDbId } });
}

function countBy<T extends string>(values: T[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

async function writeDeveloperSnapshot(input: {
  session_public_id: string;
  item_responses: unknown;
  process_events: unknown;
  conversation_turns: unknown;
  response_package: unknown;
}) {
  const outputDir = path.join(process.cwd(), ".data", "student-logging-smoke");
  const outputPath = path.join(outputDir, `${input.session_public_id}.json`);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(input, null, 2));

  return outputPath;
}

async function completeCurrentItem(input: {
  student_user_db_id: string;
  session_public_id: string;
  state: Awaited<ReturnType<typeof startConceptUnitInitialAdministration>>;
  prefix: string;
  index: number;
  with_tempting_reason?: boolean;
}) {
  const item = input.state.current_item;

  assert(item, `Item ${input.index} is missing from state.`);
  const selectedOption = item.options[0]?.label;
  const temptingOption = item.options.find((option) => option.label !== selectedOption)?.label;

  assert(selectedOption, `Item ${input.index} has no selected option candidate.`);
  assert(temptingOption, `Item ${input.index} has no alternate tempting option candidate.`);

  let state = (
    await recordSelectedOption({
      student_user_db_id: input.student_user_db_id,
      session_public_id: input.session_public_id,
      item_public_id: item.item_public_id,
      data: {
        selected_option: selectedOption,
        client_action_id: `${input.prefix}_item${input.index}_answer`
      }
    })
  ).state;
  assert(state.assessment_state === "AWAIT_REASON", `Item ${input.index} did not request reasoning.`);

  state = (
    await recordReasoning({
      student_user_db_id: input.student_user_db_id,
      session_public_id: input.session_public_id,
      item_public_id: item.item_public_id,
      data: {
        reasoning_text: `Reasoning for item ${input.index}: theta stays on the linked scale while item parameters affect response probabilities.`,
        client_action_id: `${input.prefix}_item${input.index}_reasoning`
      }
    })
  ).state;
  assert(state.assessment_state === "AWAIT_CONFIDENCE", `Item ${input.index} did not request confidence.`);

  state = (
    await recordConfidence({
      student_user_db_id: input.student_user_db_id,
      session_public_id: input.session_public_id,
      item_public_id: item.item_public_id,
      data: {
        confidence_rating: input.index === 2 ? "medium" : "high",
        client_action_id: `${input.prefix}_item${input.index}_confidence`
      }
    })
  ).state;
  assert(
    state.assessment_state === "AWAIT_TEMPTING_OPTION",
    `Item ${input.index} did not request tempting-option evidence.`
  );

  if (input.with_tempting_reason) {
    state = (
      await recordTemptingOption({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id,
        item_public_id: item.item_public_id,
        data: {
          tempting_option: temptingOption,
          client_action_id: `${input.prefix}_item${input.index}_tempting_option`
        }
      })
    ).state;
    assert(
      state.assessment_state === "AWAIT_TEMPTING_REASON",
      `Item ${input.index} did not ask for a tempting-option reason.`
    );

    state = (
      await recordTemptingOption({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id,
        item_public_id: item.item_public_id,
        data: {
          tempting_option_reason: "It reused similar wording from the stem.",
          client_action_id: `${input.prefix}_item${input.index}_tempting_reason`
        }
      })
    ).state;
  } else {
    state = (
      await recordTemptingOption({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id,
        item_public_id: item.item_public_id,
        data: {
          no_tempting_option: true,
          client_action_id: `${input.prefix}_item${input.index}_no_tempting`
        }
      })
    ).state;
  }

  return state;
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  await ensureDemoStudentAssessment(prisma);

  const prefix = `student_logging_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await prisma.user.create({
    data: {
      user_id: prefix,
      user_id_normalized: normalizeUserId(prefix),
      role: "student",
      access_code_hash: await hashSecret("student_logging_smoke_access")
    }
  });
  const sessionPublicIds: string[] = [];

  try {
    const started = await startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: demoAssessmentPublicId
    });
    sessionPublicIds.push(started.session.session_public_id);

    let state = await startConceptUnitInitialAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
    });
    assert(state.assessment_state === "AWAIT_ANSWER", "Initial administration did not present item 1.");

    state = await completeCurrentItem({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      state,
      prefix,
      index: 1
    });
    assert(state.assessment_state === "AWAIT_ANSWER", "Item 1 did not advance to item 2.");

    state = await completeCurrentItem({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      state,
      prefix,
      index: 2,
      with_tempting_reason: true
    });
    assert(state.assessment_state === "AWAIT_ANSWER", "Item 2 did not advance to item 3.");

    state = await completeCurrentItem({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      state,
      prefix,
      index: 3
    });
    assert(state.assessment_state === "PACKAGE_REVIEW", "Three-item package did not enter review.");

    const completed = await completeInitialConceptUnitAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
    });
    assert(completed.completion_status === "completed", "Package submission did not complete.");

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session_db_id: session.id },
      select: { id: true }
    });
    const [itemResponses, processEvents, conversationTurns, responsePackage, transcript] =
      await Promise.all([
        prisma.itemResponse.findMany({
          where: { concept_unit_session_db_id: conceptUnitSession.id },
          orderBy: { created_at: "asc" },
          select: {
            selected_option: true,
            reasoning_text: true,
            confidence_rating: true,
            item_started_at: true,
            item_submitted_at: true,
            item_response_time_ms: true
          }
        }),
        prisma.processEvent.findMany({
          where: { assessment_session_db_id: session.id },
          orderBy: { occurred_at: "asc" },
          select: {
            event_type: true,
            event_source: true,
            payload: true,
            occurred_at: true
          }
        }),
        prisma.conversationTurn.findMany({
          where: { assessment_session_db_id: session.id },
          orderBy: { created_at: "asc" },
          select: {
            actor_type: true,
            agent_name: true,
            message_text: true,
            structured_payload: true,
            created_at: true
          }
        }),
        prisma.responsePackage.findFirstOrThrow({
          where: {
            concept_unit_session_db_id: conceptUnitSession.id,
            package_type: "initial_concept_unit_response_package"
          },
          select: { payload: true }
        }),
        getStudentSafeTranscript({
          student_user_db_id: student.id,
          session_public_id: started.session.session_public_id
        })
      ]);

    assert(itemResponses.length === 3, "Expected three item responses.");
    for (const response of itemResponses) {
      assert(response.selected_option, "Item response missing selected answer.");
      assert(response.reasoning_text, "Item response missing reasoning text.");
      assert(response.confidence_rating, "Item response missing confidence.");
      assert(response.item_started_at, "Item response missing item_started_at.");
      assert(response.item_submitted_at, "Item response missing item_completed_at/item_submitted_at.");
      assert(
        typeof response.item_response_time_ms === "number",
        "Item response missing total item response time."
      );
    }

    const eventCounts = countBy(processEvents.map((event) => event.event_type));
    assert(eventCounts.session_started === 1, "session_started event missing.");
    assert(eventCounts.item_presented === 3, "Expected three item_presented events.");
    assert((eventCounts.agent_message_shown ?? 0) >= 13, "Agent prompt events missing.");
    assert(eventCounts.option_clicked === 3, "option_clicked events missing.");
    assert(eventCounts.option_selected === 3, "Legacy option_selected events missing.");
    assert(eventCounts.reasoning_submitted === 3, "reasoning_submitted events missing.");
    assert(eventCounts.confidence_clicked === 3, "confidence_clicked events missing.");
    assert(eventCounts.tempting_option_submitted === 4, "tempting_option_submitted events mismatch.");
    assert(
      eventCounts.tempting_option_reason_submitted === 1,
      "tempting_option_reason_submitted event missing."
    );
    assert(eventCounts.item_completed === 3, "item_completed events missing.");
    assert(eventCounts.package_review_opened === 1, "package_review_opened event missing.");
    assert(eventCounts.package_submitted === 1, "package_submitted event missing.");

    assert(
      conversationTurns.some((turn) => turn.agent_name === "deterministic_initial_administration"),
      "Deterministic initial agent prompts were not stored as conversation turns."
    );
    assert(
      transcript.transcript.some((entry) => entry.actor === "assistant" && entry.message_text.includes("Question 1 of 3")),
      "Student-safe transcript is missing the agent item presentation."
    );
    assert(
      transcript.transcript.some((entry) => entry.actor === "student" && entry.message_text.includes("Reasoning for item")),
      "Student-safe transcript is missing student reasoning."
    );
    const transcriptText = JSON.stringify(transcript.transcript);
    assert(!transcriptText.includes("correct_option"), "Student transcript leaked correct_option.");
    assert(!transcriptText.includes("distractor_rationales"), "Student transcript leaked distractor metadata.");
    assert(!transcriptText.includes("correctness"), "Student transcript leaked correctness.");

    const packagePayload = responsePackage.payload as {
      item_responses?: Array<Record<string, unknown>>;
      included_items?: Array<Record<string, unknown>>;
      response_package_evidence?: Record<string, unknown>;
      logging_limitations?: Record<string, unknown>;
    };
    assert(packagePayload.item_responses?.length === 3, "Response package missing item responses.");
    assert(
      packagePayload.item_responses.every((response) => response.item_role && response.cognitive_demand),
      "Response package item responses are missing fixed IRT item metadata."
    );
    assert(
      packagePayload.item_responses.some((response) => response.tempting_option_reason),
      "Response package missing tempting-option reason evidence."
    );
    assert(
      packagePayload.item_responses.some((response) => response.no_tempting_option === true),
      "Response package missing no-tempting-option evidence."
    );
    assert(
      packagePayload.included_items?.every((item) => item.item_role && item.difficulty),
      "Response package included items are missing fixed IRT metadata."
    );
    assert(
      packagePayload.response_package_evidence?.includes_tempting_option_evidence === true,
      "Response package evidence summary did not detect tempting-option evidence."
    );
    assert(
      packagePayload.logging_limitations?.reasoning_started_at,
      "Response package should document reasoning_started_at limitation."
    );

    const snapshotPath = await writeDeveloperSnapshot({
      session_public_id: started.session.session_public_id,
      item_responses: itemResponses,
      process_events: processEvents,
      conversation_turns: conversationTurns,
      response_package: responsePackage.payload
    });

    console.log(
      `Student logging smoke test passed. Developer evidence snapshot: ${snapshotPath}. No OpenAI calls are made by this script.`
    );
  } finally {
    await cleanup(student.id, sessionPublicIds);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
