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
  submitFormativeActivityResponse
} from "../src/lib/services/student-assessment/service";
import {
  ChatNativeFormativeProfileOutputSchema
} from "../src/lib/services/student-assessment/formative-profile";
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

function assertStudentVisibleTextIsSafe(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "response profile",
    "formative need",
    "metadata",
    "answer key",
    "system prompt",
    "structured output",
    "ability_profile",
    "engagement_profile",
    "integrated_diagnostic_profile",
    "formative_value",
    "correct_option",
    "correctness"
  ];

  for (const term of forbidden) {
    assert(!serialized.includes(term), `Student-visible payload leaked ${term}.`);
  }
}

async function completeItemFromState(input: {
  studentDbId: string;
  sessionPublicId: string;
  prefix: string;
  state: Awaited<ReturnType<typeof startConceptUnitInitialAdministration>>;
  itemIndex: number;
  withTemptingReason?: boolean;
}) {
  const item = input.state.current_item;
  assert(item, `Expected item ${input.itemIndex}.`);
  const option = item.options[0]?.label;
  assert(option, `Item ${input.itemIndex} needs option A.`);

  let state = (
    await recordSelectedOption({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        selected_option: option,
        client_action_id: `${input.prefix}_item${input.itemIndex}_answer`
      }
    })
  ).state;
  state = (
    await recordReasoning({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        reasoning_text: `My reason for item ${input.itemIndex} compares item information with theta.`,
        client_action_id: `${input.prefix}_item${input.itemIndex}_reason`
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
        client_action_id: `${input.prefix}_item${input.itemIndex}_confidence`
      }
    })
  ).state;

  if (input.withTemptingReason) {
    const temptingOption = item.options[1]?.label ?? item.options[0]?.label;
    assert(temptingOption, `Item ${input.itemIndex} needs a tempting option.`);
    state = (
      await recordTemptingOption({
        student_user_db_id: input.studentDbId,
        session_public_id: input.sessionPublicId,
        item_public_id: item.item_public_id,
        data: {
          tempting_option: temptingOption,
          client_action_id: `${input.prefix}_item${input.itemIndex}_tempting`
        }
      })
    ).state;
    state = (
      await recordTemptingOption({
        student_user_db_id: input.studentDbId,
        session_public_id: input.sessionPublicId,
        item_public_id: item.item_public_id,
        data: {
          tempting_option_reason: "It used similar language about the scale.",
          client_action_id: `${input.prefix}_item${input.itemIndex}_tempting_reason`
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
          client_action_id: `${input.prefix}_item${input.itemIndex}_tempting_no`
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

  const prefix = `phase5_formative_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await prisma.user.create({
    data: {
      user_id: prefix,
      user_id_normalized: normalizeUserId(prefix),
      role: "student",
      access_code_hash: await hashSecret("phase5_formative_access")
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

    state = await completeItemFromState({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      prefix,
      state,
      itemIndex: 1
    });
    state = await completeItemFromState({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      prefix,
      state,
      itemIndex: 2,
      withTemptingReason: true
    });
    state = await completeItemFromState({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      prefix,
      state,
      itemIndex: 3
    });
    assert(state.assessment_state === "PACKAGE_REVIEW", "Initial package did not enter review.");

    const completed = await completeInitialConceptUnitAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
    });

    assert(completed.state.assessment_state === "FORMATIVE_ACTIVITY", "Expected formative activity state.");
    assert(completed.state.next_step === "formative_activity", "Expected formative activity next step.");
    assert(completed.state.current_phase === "planning_completed", "Expected planning_completed phase.");
    assert(completed.state.formative_activity?.can_send, "Formative activity should accept one response.");
    assertStudentVisibleTextIsSafe(completed.state);

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session_db_id: session.id },
      select: { id: true }
    });
    const responsePackage = await prisma.responsePackage.findFirstOrThrow({
      where: {
        concept_unit_session_db_id: conceptUnitSession.id,
        package_type: "initial_concept_unit_response_package"
      }
    });
    const packagePayload = responsePackage.payload as Record<string, unknown>;
    assert(Array.isArray(packagePayload.item_responses), "Response package lacks item responses.");
    assert((packagePayload.item_responses as unknown[]).length === 3, "Response package should include three item responses.");

    const agentCall = await prisma.agentCall.findFirstOrThrow({
      where: {
        assessment_session_db_id: session.id,
        agent_name: "formative_value_and_planning_agent",
        schema_version: "chat-native-formative-profile-output-v1"
      }
    });
    assert(agentCall.provider === "mock", "Smoke test should use mock provider.");
    assert(agentCall.live_call_allowed === false, "Smoke test must not allow live calls.");
    const parsedOutput = ChatNativeFormativeProfileOutputSchema.safeParse(agentCall.output_payload);
    assert(parsedOutput.success, "Stored formative profile output did not validate.");
    assert(parsedOutput.data.next_expected_action === "respond_to_formative_activity", "Unexpected next expected action.");

    const [profileCount, decisionCount, round] = await Promise.all([
      prisma.studentProfile.count({ where: { concept_unit_session_db_id: conceptUnitSession.id } }),
      prisma.formativeDecision.count({ where: { concept_unit_session_db_id: conceptUnitSession.id } }),
      prisma.followupRound.findFirstOrThrow({
        where: { concept_unit_session_db_id: conceptUnitSession.id },
        orderBy: [{ round_index: "desc" }]
      })
    ]);
    assert(profileCount === 1, "Expected one stored student profile.");
    assert(decisionCount === 1, "Expected one stored formative decision.");
    assert(round.status === "active", "Expected one active formative activity round.");

    const transcript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(
      transcript.transcript.some((turn) => turn.interaction_type === "formative_activity"),
      "Transcript does not include the formative activity."
    );
    assertStudentVisibleTextIsSafe(transcript);

    const events = await prisma.processEvent.findMany({
      where: { assessment_session_db_id: session.id },
      select: { event_type: true }
    });
    const eventTypes = new Set(events.map((event) => event.event_type));
    for (const expected of [
      "package_submitted",
      "llm_profile_requested",
      "llm_profile_received",
      "formative_activity_shown"
    ]) {
      assert(eventTypes.has(expected), `Missing process event: ${expected}`);
    }

    const agentCallCountBeforeResponse = await prisma.agentCall.count({
      where: { assessment_session_db_id: session.id }
    });
    const response = await submitFormativeActivityResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message: "Theta describes the person location, while difficulty describes the item location.",
      client_message_id: `${prefix}_activity_response`
    });
    assert(response.message_status === "saved", "Formative response was not saved.");
    assert(response.targeted_feedback_available === false, "Targeted feedback should remain unavailable.");
    assert(response.state.next_step === "formative_response_saved", "Expected saved response state.");
    const agentCallCountAfterResponse = await prisma.agentCall.count({
      where: { assessment_session_db_id: session.id }
    });
    assert(
      agentCallCountAfterResponse === agentCallCountBeforeResponse,
      "Submitting the activity response should not call another agent."
    );

    const submittedRound = await prisma.followupRound.findUniqueOrThrow({
      where: { id: round.id }
    });
    assert(submittedRound.status === "completed", "Formative activity round should be completed after response.");
    const followupEventCount = await prisma.processEvent.count({
      where: {
        assessment_session_db_id: session.id,
        event_type: "followup_response_submitted"
      }
    });
    assert(followupEventCount === 1, "Expected one followup_response_submitted event.");

    console.log("Phase 5 student formative profile smoke test passed. No OpenAI calls are made by this script.");
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
