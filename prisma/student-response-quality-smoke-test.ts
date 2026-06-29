import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  assert,
  assertStudentVisibleTextIsSafe,
  cleanupSmokeStudentSessions,
  createSmokeStudent,
  eventCounts
} from "./student-mvp-smoke-helpers";
import {
  completeInitialConceptUnitAdministration,
  getStudentSafeTranscript,
  getStudentSessionState,
  recordConfidence,
  recordReasoning,
  recordSelectedOption,
  recordTemptingOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  updateInFlowItemResponse
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  submitChatNativeFormativeActivityResponse
} from "../src/lib/services/student-assessment/formative-profile";
import { buildStudentConversationFrame } from "../src/lib/student-assessment-ui/presenter";
import { buildInitialAdminPrompt } from "../src/lib/student-assessment/initial-admin-prompts";
import { resolveItemAdministrationTutorRuntimeMode } from "../src/lib/services/student-assessment/item-administration-tutor";

const prisma = new PrismaClient();

async function assertStudentComponentQualityShape() {
  const source = await readFile(
    path.join(process.cwd(), "src/components/student-assessment/assessment-session-client.tsx"),
    "utf8"
  );
  const agentItemStart = source.indexOf("function AgentItemMessage");
  const confidenceStart = source.indexOf("function ConfidenceMessage");
  const agentItemSource =
    agentItemStart >= 0 && confidenceStart > agentItemStart
      ? source.slice(agentItemStart, confidenceStart)
      : "";

  assert(source.includes("I don't know yet."), "E uncertainty option copy is missing.");
  assert(source.includes("answerOptionsFor(item).map"), "Answer option cards should include the E option.");
  assert(agentItemSource.includes("<button"), "Answer option cards should be buttons.");
  assert(!agentItemSource.includes("<OptionChip"), "Answer selection should not render separate A-D chips.");
  assert(source.includes("in-flow-edit-panel"), "In-flow edit affordance is missing.");
  assert(source.includes("Current learning profile"), "Student-safe learning profile panel is missing.");
  assert(!source.includes("submit-item"), "Initial item-level submit should not return.");
}

function assertInitialPromptVariation() {
  const prompts = [1, 2, 3].map((itemOrder) =>
    buildInitialAdminPrompt({
      kind: "answer_prompt",
      assessmentState: "AWAIT_ANSWER",
      itemPublicId: `synthetic_item_${itemOrder}`,
      itemOrder,
      itemRole: "initial"
    }).prompt_text
  );

  assert(new Set(prompts).size > 1, "Mock initial prompt wording should vary across items.");
  const reasoningPrompt = buildInitialAdminPrompt({
    kind: "reasoning_prompt",
    assessmentState: "AWAIT_REASON",
    itemPublicId: "synthetic_item_reasoning",
    itemOrder: 1,
    itemRole: "initial",
    selectedOption: "C"
  }).prompt_text;
  assert(
    /detail|more useful my feedback|explain your reasoning/i.test(reasoningPrompt),
    "Reasoning prompt should invite detailed explanation."
  );
  assert(
    [...prompts, reasoningPrompt].every((prompt) => !/correct answer|answer key|structured output|agent call/i.test(prompt)),
    "Initial prompts should not expose protected or internal language."
  );
}

function withTemporaryEnv(values: Record<string, string | undefined>, callback: () => void) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );

  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function assertItemAdminRuntimeModeResolution() {
  withTemporaryEnv(
    {
      ITEM_ADMIN_TUTOR_MODE: "auto",
      LLM_PROVIDER: "openai",
      LLM_LIVE_CALLS_ENABLED: "true",
      OPENAI_API_KEY: "test-item-admin-mode-resolution-key",
      OPENAI_MODEL_ITEM_ADMIN: "gpt-test-item-admin",
      OPENAI_MODEL_FOLLOWUP: ""
    },
    () => {
      const mode = resolveItemAdministrationTutorRuntimeMode();
      assert(mode.configured_mode === "auto", "Item admin mode should default through auto.");
      assert(mode.resolved_source === "live_llm", "Auto mode should resolve live when live config is ready.");
      assert(mode.live_config_ready, "Auto mode should report live config ready.");
      assert(mode.model_name === "gpt-test-item-admin", "Item admin model should come from OPENAI_MODEL_ITEM_ADMIN.");
    }
  );

  withTemporaryEnv(
    {
      ITEM_ADMIN_TUTOR_MODE: "mock",
      LLM_PROVIDER: "openai",
      LLM_LIVE_CALLS_ENABLED: "true",
      OPENAI_API_KEY: "test-item-admin-mode-resolution-key",
      OPENAI_MODEL_ITEM_ADMIN: "gpt-test-item-admin",
      OPENAI_MODEL_FOLLOWUP: ""
    },
    () => {
      const mode = resolveItemAdministrationTutorRuntimeMode();
      assert(mode.configured_mode === "mock", "Mock mode should be explicit.");
      assert(mode.resolved_source === "deterministic_mock", "Mock mode should force deterministic tutor.");
      assert(
        mode.blocking_reasons.includes("item_admin_tutor_mode_mock"),
        "Mock mode should report that it forced deterministic behavior."
      );
    }
  );
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";

  await assertStudentComponentQualityShape();
  assertInitialPromptVariation();
  assertItemAdminRuntimeModeResolution();
  await ensureDemoStudentAssessment(prisma);

  const prefix = `phase13_quality_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: "phase13_quality_access"
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
    const firstItem = state.current_item;
    assert(firstItem, "Expected first item.");
    assert(state.assessment_state === "AWAIT_ANSWER", "Initial state should await the first answer.");
    assert(!state.learning_profile, "Learning profile must be hidden during Q1 answer collection.");

    state = (
      await recordSelectedOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          selected_option: "E",
          client_action_id: `${prefix}_idk_answer`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "E selection should ask for reasoning.");
    assert(state.current_item?.existing_selected_option === "E", "E selection should persist.");
    assert(!state.learning_profile, "Learning profile must be hidden during Q1 reasoning collection.");

    let response = await prisma.itemResponse.findFirstOrThrow({
      where: {
        item: { item_public_id: firstItem.item_public_id },
        concept_unit_session: { assessment_session: { session_public_id: started.session.session_public_id } }
      },
      select: { correctness: true, reasoning_text: true }
    });
    assert(response.correctness === "not_scored", "E should be stored as explicit uncertainty, not incorrect.");

    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          reasoning_text: "deadw",
          client_action_id: `${prefix}_gibberish_reason`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "Gibberish reasoning should not advance.");

    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          reasoning_text: "I think",
          client_action_id: `${prefix}_short_reason`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "Very short reasoning should not advance.");
    response = await prisma.itemResponse.findFirstOrThrow({
      where: {
        item: { item_public_id: firstItem.item_public_id },
        concept_unit_session: { assessment_session: { session_public_id: started.session.session_public_id } }
      },
      select: { correctness: true, reasoning_text: true }
    });
    assert(!response.reasoning_text, "Rejected reasoning should not be stored on item_responses.");

    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          reasoning_text: "B",
          client_action_id: `${prefix}_mark_unknown_reason`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_CONFIDENCE", "Marking unknown reasoning should advance.");
    assert(!state.learning_profile, "Learning profile must be hidden during Q1 confidence collection.");
    response = await prisma.itemResponse.findFirstOrThrow({
      where: {
        item: { item_public_id: firstItem.item_public_id },
        concept_unit_session: { assessment_session: { session_public_id: started.session.session_public_id } }
      },
      select: { correctness: true, reasoning_text: true }
    });
    assert(
      response.reasoning_text === "I don't know the reason yet.",
      "Unknown reasoning choice should be stored explicitly."
    );
    let frame = buildStudentConversationFrame(state);
    assert(
      frame.assistant_message.includes("Since you indicated uncertainty"),
      "E selection should produce adapted confidence prompt."
    );

    const editedReasoning =
      "It is hard because I can tell theta belongs to the person, but the item parameter wording is still close.";
    state = (
      await updateInFlowItemResponse({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          reasoning_text: editedReasoning,
          client_action_id: `${prefix}_edit_reasoning`
        }
      })
    ).state;
    assert(state.current_item?.existing_reasoning_text === editedReasoning, "Edited reasoning should hydrate.");

    state = (
      await recordConfidence({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          confidence_rating: "low",
          client_action_id: `${prefix}_confidence`
        }
      })
    ).state;
    assert(!state.learning_profile, "Learning profile must be hidden during Q1 tempting-option collection.");
    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          no_tempting_option: true,
          client_action_id: `${prefix}_no_tempting`
        }
      })
    ).state;

    const secondItem = state.current_item;
    assert(secondItem, "Expected second item after first uncertainty response.");
    assert(!state.learning_profile, "Learning profile must be hidden during Q2 answer collection.");
    const secondSelectedOption = secondItem.options[0]?.label ?? "A";
    state = (
      await recordSelectedOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: secondItem.item_public_id,
        data: {
          selected_option: secondSelectedOption,
          client_action_id: `${prefix}_item2_option`
        }
      })
    ).state;
    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: secondItem.item_public_id,
        data: {
          reasoning_text: "Can you explain theta before I answer?",
          client_action_id: `${prefix}_item2_content_question`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "Content question should be deferred without advancing.");
    assert(!state.learning_profile, "Learning profile must be hidden while Q2 content help is deferred.");
    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: secondItem.item_public_id,
        data: {
          reasoning_text: "I'm confused.",
          client_action_id: `${prefix}_item2_affect_reasoning`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "Pure affective confusion should be acknowledged without advancing.");
    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: secondItem.item_public_id,
        data: {
          reasoning_text: "I don't know the reason yet.",
          client_action_id: `${prefix}_item2_unknown_reasoning`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_CONFIDENCE", "Explicit unknown reasoning should advance as low-information evidence.");
    assert(!state.learning_profile, "Learning profile must be hidden during Q2 confidence collection.");
    frame = buildStudentConversationFrame(state);
    assert(
      frame.assistant_message.includes("I'll record that you are unsure about the reason"),
      "Uncertain reasoning should produce adapted confidence prompt."
    );
    state = (
      await recordConfidence({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: secondItem.item_public_id,
        data: {
          confidence_rating: "low",
          client_action_id: `${prefix}_item2_confidence`
        }
      })
    ).state;
    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: secondItem.item_public_id,
        data: {
          no_tempting_option: true,
          client_action_id: `${prefix}_item2_no_tempting`
        }
      })
    ).state;

    const thirdItem = state.current_item;
    assert(thirdItem, "Expected third item after Q2.");
    assert(!state.learning_profile, "Learning profile must be hidden during Q3 answer collection.");
    state = (
      await recordSelectedOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: thirdItem.item_public_id,
        data: {
          selected_option: thirdItem.options[0]?.label ?? "A",
          client_action_id: `${prefix}_item3_option`
        }
      })
    ).state;
    assert(!state.learning_profile, "Learning profile must be hidden during Q3 reasoning collection.");
    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: thirdItem.item_public_id,
        data: {
          reasoning_text: "Theta stays tied to the person estimate while item parameters describe item features.",
          client_action_id: `${prefix}_item3_reasoning`
        }
      })
    ).state;
    assert(!state.learning_profile, "Learning profile must be hidden during Q3 confidence collection.");
    state = (
      await recordConfidence({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: thirdItem.item_public_id,
        data: {
          confidence_rating: "medium",
          client_action_id: `${prefix}_item3_confidence`
        }
      })
    ).state;
    assert(!state.learning_profile, "Learning profile must be hidden during Q3 tempting-option collection.");
    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: thirdItem.item_public_id,
        data: {
          no_tempting_option: true,
          client_action_id: `${prefix}_item3_no_tempting`
        }
      })
    ).state;
    assert(state.assessment_state === "PACKAGE_REVIEW", "Initial package should reach review.");
    assert(!state.learning_profile, "Learning profile should not appear before package analysis creates one.");

    state = (
      await completeInitialConceptUnitAdministration({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
      })
    ).state;
    assert(state.assessment_state === "FORMATIVE_ACTIVITY", "Mock formative activity should be available.");
    assert(state.learning_profile, "Student learning profile should be available after package analysis.");
    assert(
      JSON.stringify(Object.keys(state.learning_profile).sort()) ===
        JSON.stringify(["mostly_understood", "needs_more_work", "still_developing", "updated_at"].sort()),
      "Learning profile should expose only the three student-facing categories plus timestamp."
    );
    assert(state.learning_profile.needs_more_work.length > 0, "Learning profile should include a needs-more-work description.");
    assert(
      !/\b(the student|they|their|engagement profile|formative need|metadata|structured output|agent call)\b/i.test(
        JSON.stringify(state.learning_profile)
      ),
      "Learning profile should use direct student-facing wording without internal labels."
    );
    const postPackageTranscript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    const postPackageText = postPackageTranscript.transcript.map((entry) => entry.message_text).join("\n");
    assert(/three responses|first three questions/i.test(postPackageText), "Post-package summary missing.");
    assert(
      !/\bWhat you did well:|Still developing:|Reasoning detail:|Current focus:/i.test(postPackageText),
      "Post-package summary should not expose visible template headings."
    );
    assert(/theta/i.test(postPackageText), "Deferred content question should be referenced after package completion.");
    assertStudentVisibleTextIsSafe(postPackageTranscript);

    const offTopic = await submitChatNativeFormativeActivityResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message: "What is the weather today?",
      client_message_id: `${prefix}_off_topic_activity`
    });
    assert(
      offTopic.targeted_feedback_available === false,
      "Off-topic formative response should not create targeted feedback."
    );
    state = await getStudentSessionState({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(state.assessment_state === "FORMATIVE_ACTIVITY", "Off-topic formative response should stay on activity.");

    const clarification = await submitChatNativeFormativeActivityResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message: "Can you clarify what I should write?",
      client_message_id: `${prefix}_clarify_activity`
    });
    assert(
      clarification.targeted_feedback_available === false,
      "Clarification request should not create targeted feedback."
    );

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const events = await prisma.processEvent.findMany({
      where: { assessment_session_db_id: session.id },
      select: { event_type: true, payload: true }
    });
    const counts = eventCounts(events);
    assert((counts.idk_selected ?? 0) > 0, "idk_selected event missing.");
    assert((counts.response_quality_checked ?? 0) >= 4, "response_quality_checked events missing.");
    assert((counts.response_quality_rejected ?? 0) >= 3, "response_quality_rejected events missing.");
    assert((counts.repeated_invalid_response ?? 0) > 0, "Repeated invalid response event missing.");
    assert((counts.insufficient_knowledge_marked ?? 0) > 0, "Insufficient knowledge event missing.");
    assert((counts.student_response_edit_submitted ?? 0) > 0, "In-flow edit event missing.");
    assert((counts.reasoning_edited ?? 0) > 0, "Reasoning edit event missing.");
    assert((counts.clarification_answered ?? 0) > 0, "Clarification event missing.");
    assert(
      JSON.stringify(events.map((event) => event.payload)).includes('"item_admin_tutor_source":"deterministic_mock"'),
      "Item administration tutor source should be recorded in process-event evidence."
    );

    const transcript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(
      transcript.transcript.some((entry) => entry.message_text === "I don't know yet."),
      "E selection should appear as an uncertainty chat bubble."
    );
    assertStudentVisibleTextIsSafe(transcript);

    console.log("Student response-quality smoke passed. No OpenAI calls are made by this script.");
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
