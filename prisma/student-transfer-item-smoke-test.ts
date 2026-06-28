import { randomUUID } from "node:crypto";
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
  startOrResumeStudentAssessmentSession,
  submitFormativeActivityResponse,
  submitNextChoice,
  submitRevisionResponse
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  demoItemPublicIds,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import type { StudentSessionState } from "../src/lib/student-assessment-ui/types";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function itemRole(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const role = (value as Record<string, unknown>).item_role;
  return typeof role === "string" ? role : null;
}

function assertStudentVisibleTextIsSafe(value: unknown) {
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
  await prisma.agentCall.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.followupRound.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.formativeDecision.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.studentProfile.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.itemResponse.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.conceptUnitSession.deleteMany({ where: { id: { in: conceptUnitSessionIds } } });
  await prisma.assessmentSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.user.deleteMany({ where: { id: userDbId } });
}

async function completeInitialItem(input: {
  studentDbId: string;
  sessionPublicId: string;
  prefix: string;
  state: StudentSessionState;
  itemIndex: number;
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

  return state;
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  await ensureDemoStudentAssessment(prisma);

  const prefix = `phase7_transfer_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await prisma.user.create({
    data: {
      user_id: prefix,
      user_id_normalized: normalizeUserId(prefix),
      role: "student",
      access_code_hash: await hashSecret("phase7_transfer_access")
    },
    select: { id: true }
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

    for (const itemIndex of [1, 2, 3]) {
      state = await completeInitialItem({
        studentDbId: student.id,
        sessionPublicId: started.session.session_public_id,
        prefix,
        state,
        itemIndex
      });
    }
    assert(state.assessment_state === "PACKAGE_REVIEW", "Expected package review after three initial items.");

    const completedInitial = await completeInitialConceptUnitAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
    });
    assert(completedInitial.state.assessment_state === "FORMATIVE_ACTIVITY", "Expected formative activity.");

    const activity = await submitFormativeActivityResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message:
        "Theta is the person's location on the linked scale, while item difficulty describes where an item is located.",
      client_message_id: `${prefix}_formative_activity`
    });
    assert(activity.state.assessment_state === "REVISION", "Expected revision after targeted feedback.");

    const revision = await submitRevisionResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message:
        "Theta describes the student on the linked latent trait scale, while item parameters describe item behavior.",
      client_message_id: `${prefix}_revision`
    });
    assert(revision.state.assessment_state === "NEXT_CHOICE", "Expected next choice after revision.");

    const choiceB = await submitNextChoice({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      choice: "try_another",
      client_action_id: `${prefix}_next_choice_b`
    });
    assert(choiceB.choice_status === "transfer_item_started", "Choice B should start transfer item delivery.");
    assert(choiceB.state.assessment_state === "TRANSFER_ITEM", "Expected transfer item answer state.");
    assert(choiceB.state.next_step === "transfer_item", "Expected transfer item next step.");
    assert(
      choiceB.state.current_item?.item_public_id === demoItemPublicIds[3],
      "Expected the seeded transfer item."
    );
    assertStudentVisibleTextIsSafe(choiceB.state);

    const transferItem = choiceB.state.current_item;
    assert(transferItem, "Transfer item should be present.");
    const selectedOption = transferItem.options[2]?.label ?? transferItem.options[0]?.label;
    const temptingOption = transferItem.options.find((option) => option.label !== selectedOption)?.label;
    assert(selectedOption, "Transfer item needs a selected option.");
    assert(temptingOption, "Transfer item needs an alternate tempting option.");

    state = (
      await recordSelectedOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: transferItem.item_public_id,
        data: {
          selected_option: selectedOption,
          client_action_id: `${prefix}_transfer_answer`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "Transfer answer should advance to reason.");

    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: transferItem.item_public_id,
        data: {
          reasoning_text:
            "The estimates are on the same linked theta scale, even if the item mix affects precision.",
          client_action_id: `${prefix}_transfer_reason`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_CONFIDENCE", "Transfer reason should advance to confidence.");

    state = (
      await recordConfidence({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: transferItem.item_public_id,
        data: {
          confidence_rating: "high",
          client_action_id: `${prefix}_transfer_confidence`
        }
      })
    ).state;
    assert(
      state.assessment_state === "AWAIT_TEMPTING_OPTION",
      "Transfer confidence should advance to tempting option."
    );

    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: transferItem.item_public_id,
        data: {
          tempting_option: temptingOption,
          client_action_id: `${prefix}_transfer_tempting`
        }
      })
    ).state;
    assert(
      state.assessment_state === "AWAIT_TEMPTING_REASON",
      "Transfer tempting option should ask for a reason."
    );

    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: transferItem.item_public_id,
        data: {
          tempting_option_reason: "asdf",
          client_action_id: `${prefix}_transfer_bad_tempting_reason`
        }
      })
    ).state;
    assert(
      state.assessment_state === "AWAIT_TEMPTING_REASON",
      "Bad transfer tempting-option reason should not complete the session."
    );

    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: transferItem.item_public_id,
        data: {
          tempting_option_reason: "B",
          client_action_id: `${prefix}_transfer_unknown_tempting_reason`
        }
      })
    ).state;
    assert(state.assessment_state === "SESSION_COMPLETE", "Unknown transfer tempting reason should complete the session.");

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true, current_phase: true, status: true }
    });
    assert(session.current_phase === "session_completed", "Session phase should be complete.");
    assert(session.status === "completed", "Session status should be complete.");

    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session_db_id: session.id },
      select: { id: true }
    });
    const transferDbItem = await prisma.item.findUniqueOrThrow({
      where: { item_public_id: demoItemPublicIds[3] },
      select: {
        id: true,
        included_in_published_set: true,
        administration_rules: true
      }
    });
    assert(!transferDbItem.included_in_published_set, "Transfer item must not be in the initial set.");
    assert(itemRole(transferDbItem.administration_rules) === "transfer", "Transfer item role mismatch.");

    const transferResponse = await prisma.itemResponse.findUniqueOrThrow({
      where: {
        concept_unit_session_db_id_item_db_id: {
          concept_unit_session_db_id: conceptUnitSession.id,
          item_db_id: transferDbItem.id
        }
      }
    });
    assert(transferResponse.selected_option === selectedOption, "Transfer selected answer was not stored.");
    assert(
      transferResponse.reasoning_text?.includes("linked theta scale"),
      "Transfer reasoning was not stored."
    );
    assert(transferResponse.confidence_rating === "high", "Transfer confidence was not stored.");
    assert(transferResponse.item_submitted_at, "Transfer item was not submitted.");

    const responsePackage = await prisma.responsePackage.findFirstOrThrow({
      where: {
        concept_unit_session_db_id: conceptUnitSession.id,
        package_type: "initial_concept_unit_response_package"
      }
    });
    const packagePayload = responsePackage.payload as Record<string, unknown>;
    const packageResponses = Array.isArray(packagePayload.item_responses)
      ? packagePayload.item_responses as Array<Record<string, unknown>>
      : [];
    assert(packageResponses.length === 3, "Initial response package should contain exactly three items.");
    assert(
      packageResponses.every((response) => response.item_public_id !== demoItemPublicIds[3]),
      "Initial response package should not include the transfer item."
    );

    const eventTypes = await prisma.processEvent.findMany({
      where: { assessment_session_db_id: session.id },
      select: { event_type: true }
    });
    const eventCounts = eventTypes.reduce<Record<string, number>>((counts, event) => {
      counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
      return counts;
    }, {});

    for (const expected of [
      "next_choice_selected",
      "transfer_item_presented",
      "transfer_answer_selected",
      "transfer_reasoning_submitted",
      "transfer_confidence_clicked",
      "transfer_tempting_option_submitted",
      "transfer_tempting_option_reason_submitted",
      "transfer_item_completed",
      "session_completed"
    ]) {
      assert((eventCounts[expected] ?? 0) > 0, `Missing transfer process event ${expected}.`);
    }
    assert((eventCounts.response_quality_rejected ?? 0) > 0, "Bad transfer tempting reason should be rejected.");
    assert(
      (eventCounts.insufficient_knowledge_marked ?? 0) > 0,
      "Unknown transfer tempting reason should be logged."
    );

    const transcript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(
      transcript.transcript.some((turn) => turn.interaction_type === "transfer_item"),
      "Transcript missing transfer item presentation."
    );
    assert(
      transcript.transcript.some((turn) => turn.interaction_type === "transfer_item_completed"),
      "Transcript missing transfer completion message."
    );
    assert(
      transcript.transcript.some((turn) => turn.message_text === TRANSFER_COMPLETION_TEXT_FOR_TEST),
      "Transcript missing required transfer completion text."
    );
    assertStudentVisibleTextIsSafe(transcript);

    console.log("Phase 7 transfer item smoke test passed. No OpenAI calls are made by this script.");
  } finally {
    await cleanup(student.id, sessionPublicIds);
  }
}

const TRANSFER_COMPLETION_TEXT_FOR_TEST =
  "Thanks. Your response to the additional question has been recorded.";

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
