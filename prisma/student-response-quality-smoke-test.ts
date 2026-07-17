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
import {
  buildInitialAdminPrompt,
  temptingOptionsForSelectedAnswer
} from "../src/lib/student-assessment/initial-admin-prompts";
import { resolveItemAdministrationTutorRuntimeMode } from "../src/lib/services/student-assessment/item-administration-tutor";
import {
  withAssessmentTutorAuthCheckForTest
} from "../src/lib/llm/assessment-tutor-readiness";
import {
  detectResponseLanguage,
  deterministicResponseQuality
} from "../src/lib/services/student-assessment/response-quality";

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
  assert(source.includes("Total correct"), "Student sidebar should retain compact initial-results wording.");
  assert(source.includes("data-testid=\"initial-answer-review-list\""), "Student sidebar should retain answer reviews.");
  assert(!source.includes("What your responses show"), "Student sidebar should not duplicate the profile narrative.");
  assert(!source.includes("Your explanations"), "Student sidebar should not duplicate reasoning narrative.");
  assert(!source.includes("How sure you were"), "Student sidebar should not duplicate confidence narrative.");
  assert(!source.includes("Current learning profile"), "Student view should not use technical learning-profile wording.");
  assert(!source.includes("Confidence calibrated"), "Student view should not expose calibration wording.");
  assert(!/reasonably_calibrated|overconfident|underconfident/.test(source), "Student view should not expose confidence enum values.");
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
    !/Chinese|English, Chinese|mix of both|multilingual/i.test(reasoningPrompt),
    "Default student-facing reasoning prompts should not advertise specific language choices."
  );
  assert(
    [...prompts, reasoningPrompt].every((prompt) => !/correct answer|answer key|structured output|agent call/i.test(prompt)),
    "Initial prompts should not expose protected or internal language."
  );

  const selectedDTemptingPrompt = buildInitialAdminPrompt({
    kind: "tempting_option_prompt",
    assessmentState: "AWAIT_TEMPTING_OPTION",
    itemPublicId: "synthetic_item_tempting_d",
    itemOrder: 1,
    itemRole: "initial",
    selectedOption: "D"
  }).prompt_text;
  assert(/different option/i.test(selectedDTemptingPrompt), "Tempting prompt should ask for a different option.");

  const selectedETemptingPrompt = buildInitialAdminPrompt({
    kind: "tempting_option_prompt",
    assessmentState: "AWAIT_TEMPTING_OPTION",
    itemPublicId: "synthetic_item_tempting_e",
    itemOrder: 1,
    itemRole: "initial",
    selectedOption: "E"
  }).prompt_text;
  assert(/A-D option/.test(selectedETemptingPrompt), "E-selected tempting prompt should ask only about A-D options.");
}

function assertMultilingualResponseQuality() {
  const chineseReason = deterministicResponseQuality({
    stage: "initial_item_reasoning",
    text: "我选择C，因为theta表示人的能力，题目参数属于题目。",
    selected_option: "C"
  });
  assert(detectResponseLanguage("我选择C，因为theta表示人的能力。") === "mixed", "Mixed Chinese-English detection failed.");
  assert(chineseReason.should_advance, "Meaningful Chinese or mixed reasoning should advance.");
  assert(
    chineseReason.response_quality === "adequate" || chineseReason.response_quality === "incomplete",
    "Meaningful multilingual reasoning should not be treated as gibberish."
  );

  const contentQuestion = deterministicResponseQuality({
    stage: "initial_item_reasoning",
    text: "theta是什么？",
    selected_option: "C"
  });
  assert(!contentQuestion.should_advance, "Chinese content question should not advance.");
  assert(contentQuestion.response_quality === "content_question", "Chinese content question should be classified.");

  const gibberish = deterministicResponseQuality({
    stage: "initial_item_reasoning",
    text: "啊啊啊啊",
    selected_option: "C"
  });
  assert(!gibberish.should_advance, "Repeated non-English gibberish should not advance.");
  assert(gibberish.response_quality === "gibberish", "Repeated Chinese character should be classified as gibberish.");
}

async function withTemporaryEnv<T>(values: Record<string, string | undefined>, callback: () => Promise<T>) {
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

    return await callback();
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

async function assertItemAdminRuntimeModeResolution() {
  await withAssessmentTutorAuthCheckForTest(
    async () => ({
      auth_status: "valid",
      auth_checked_at: new Date().toISOString(),
      auth_check_error_code: null,
      http_status: 200,
      provider_request_id: "synthetic_auth_check"
    }),
    async () => {
      await withTemporaryEnv(
        {
          ITEM_ADMIN_TUTOR_MODE: "auto",
          LLM_PROVIDER: "openai",
          LLM_LIVE_CALLS_ENABLED: "true",
          OPENAI_API_KEY: "sk-test-item-admin-mode-resolution-key-000000",
          OPENAI_API_KEY_FILE: "",
          OPENAI_MODEL_ITEM_ADMIN: "gpt-test-item-admin",
          OPENAI_MODEL_FOLLOWUP: "",
          NODE_ENV: "development"
        },
        async () => {
          const mode = await resolveItemAdministrationTutorRuntimeMode();
          assert(mode.configured_mode === "auto", "Item admin mode should default through auto.");
          assert(mode.resolved_source === "live_llm", "Auto mode should resolve live when live config is ready.");
          assert(mode.live_config_ready, "Auto mode should report live config ready.");
          assert(mode.model_name === "gpt-test-item-admin", "Item admin model should come from OPENAI_MODEL_ITEM_ADMIN.");
        }
      );
    }
  );

  await withTemporaryEnv(
    {
      ITEM_ADMIN_TUTOR_MODE: "auto",
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false",
      OPENAI_API_KEY: "",
      OPENAI_MODEL_ITEM_ADMIN: "",
      OPENAI_MODEL_FOLLOWUP: "",
      npm_lifecycle_event: "",
      NODE_ENV: "development"
    },
    async () => {
      const mode = await resolveItemAdministrationTutorRuntimeMode();
      assert(
        mode.resolved_source === "configuration_blocked",
        "Development browser/runtime auto mode should not silently use mock when live config is missing."
      );
    }
  );

  await withAssessmentTutorAuthCheckForTest(
    async () => ({
      auth_status: "valid",
      auth_checked_at: new Date().toISOString(),
      auth_check_error_code: null,
      http_status: 200,
      provider_request_id: "synthetic_auth_check"
    }),
    async () => {
      await withTemporaryEnv(
        {
          ITEM_ADMIN_TUTOR_MODE: "mock",
          LLM_PROVIDER: "openai",
          LLM_LIVE_CALLS_ENABLED: "true",
          OPENAI_API_KEY: "sk-test-item-admin-mode-resolution-key-000000",
          OPENAI_API_KEY_FILE: "",
          OPENAI_MODEL_ITEM_ADMIN: "gpt-test-item-admin",
          OPENAI_MODEL_FOLLOWUP: "",
          ALLOW_LOCAL_MOCK_RUNTIME: "true",
          NODE_ENV: "development"
        },
        async () => {
          const mode = await resolveItemAdministrationTutorRuntimeMode();
          assert(mode.configured_mode === "mock", "Mock mode should be explicit.");
          assert(mode.resolved_source === "deterministic_mock", "Mock mode should force deterministic tutor.");
          assert(
            mode.blocking_reasons.includes("item_admin_tutor_mode_mock"),
            "Mock mode should report that it forced deterministic behavior."
          );
        }
      );
    }
  );
}

async function assertRuntimeBlocksOpenTextWhenReadinessFails() {
  await ensureDemoStudentAssessment(prisma);

  const prefix = `phase25b_runtime_block_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];

  try {
    let started: Awaited<ReturnType<typeof startOrResumeStudentAssessmentSession>>;
    await withTemporaryEnv(
      {
        ITEM_ADMIN_TUTOR_MODE: "mock",
        ALLOW_LOCAL_MOCK_RUNTIME: "true",
        LLM_PROVIDER: "mock",
        LLM_LIVE_CALLS_ENABLED: "false",
        OPENAI_API_KEY: "",
        OPENAI_API_KEY_FILE: "",
        OPENAI_MODEL_ITEM_ADMIN: "",
        OPENAI_MODEL_FOLLOWUP: "",
        NODE_ENV: "development"
      },
      async () => {
        started = await startOrResumeStudentAssessmentSession({
          student_user_db_id: student.id,
          assessment_public_id: demoAssessmentPublicId
        });
      }
    );
    sessionPublicIds.push(started!.session.session_public_id);

    let state = await startConceptUnitInitialAdministration({
      student_user_db_id: student.id,
      session_public_id: started!.session.session_public_id,
      concept_unit_public_id: started!.state.current_concept_unit?.concept_unit_public_id ?? ""
    });
    const item = state.current_item;
    assert(item, "Expected current item for runtime-block smoke.");

    state = (
      await recordSelectedOption({
        student_user_db_id: student.id,
        session_public_id: started!.session.session_public_id,
        item_public_id: item.item_public_id,
        data: {
          selected_option: item.options[0]?.label ?? "A",
          client_action_id: `${prefix}_answer`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "Runtime-block smoke should reach reasoning.");

    await withAssessmentTutorAuthCheckForTest(
      async () => ({
        auth_status: "invalid",
        auth_checked_at: new Date().toISOString(),
        auth_check_error_code: "invalid_api_key",
        http_status: 401,
        provider_request_id: "synthetic_invalid_auth_check"
      }),
      async () => {
        state = await withTemporaryEnv(
          {
            ITEM_ADMIN_TUTOR_MODE: "auto",
            ALLOW_LOCAL_MOCK_RUNTIME: "false",
            LLM_PROVIDER: "openai",
            LLM_LIVE_CALLS_ENABLED: "true",
            OPENAI_API_KEY: "sk-runtime-block-test-key-000000000000",
            OPENAI_API_KEY_FILE: "",
            OPENAI_MODEL_ITEM_ADMIN: "gpt-test-item-admin",
            OPENAI_MODEL_FOLLOWUP: "",
            NODE_ENV: "development",
            npm_lifecycle_event: ""
          },
          async () => (
            await recordReasoning({
              student_user_db_id: student.id,
              session_public_id: started!.session.session_public_id,
              item_public_id: item.item_public_id,
              data: {
                reasoning_text: "This should not advance while live auth is invalid.",
                client_action_id: `${prefix}_blocked_reason`
              }
            })
          ).state
        );
      }
    );

    assert(state.assessment_state === "AWAIT_REASON", "Invalid live readiness must keep reasoning open.");
    const response = await prisma.itemResponse.findFirstOrThrow({
      where: {
        item: { item_public_id: item.item_public_id },
        concept_unit_session: { assessment_session: { session_public_id: started!.session.session_public_id } }
      },
      select: { reasoning_text: true }
    });
    assert(!response.reasoning_text, "Blocked live readiness must not store open-text evidence as valid reasoning.");

    const events = await prisma.processEvent.findMany({
      where: {
        assessment_session: { session_public_id: started!.session.session_public_id }
      },
      select: { event_type: true, payload: true }
    });
    const counts = eventCounts(events);
    assert((counts.llm_runtime_blocked ?? 0) > 0, "Runtime LLM block event should be logged.");
    assert(
      JSON.stringify(events.map((event) => event.payload)).includes('"item_admin_tutor_source":"configuration_blocked"'),
      "Runtime block process event should record configuration_blocked tutor source."
    );
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
  }
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";

  await assertStudentComponentQualityShape();
  assertInitialPromptVariation();
  assertMultilingualResponseQuality();
  await assertItemAdminRuntimeModeResolution();
  await assertRuntimeBlocksOpenTextWhenReadinessFails();
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
    const temptingAfterE = temptingOptionsForSelectedAnswer(firstItem, "E").map((option) => option.label);
    assert(!temptingAfterE.includes("E"), "E must never be offered as a tempting option.");
    assert(temptingAfterE.length >= 2, "Selecting E should still allow plausible A-D tempting options.");

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
    const reasoningEditTurn = await prisma.conversationTurn.findFirst({
      where: {
        assessment_session: { session_public_id: started.session.session_public_id },
        actor_type: "student",
        item: { item_public_id: firstItem.item_public_id },
        structured_payload: {
          path: ["source"],
          equals: "student_response_in_flow_edit"
        }
      },
      orderBy: { sequence_index: "desc" },
      select: { message_text: true, structured_payload: true }
    });
    assert(reasoningEditTurn, "In-flow reasoning edit transcript turn missing.");
    assert(
      reasoningEditTurn.message_text === editedReasoning,
      "In-flow reasoning edit transcript should show the revised reasoning."
    );
    assert(
      !reasoningEditTurn.message_text.includes("Edited my response"),
      "In-flow edit transcript should not use the generic edit placeholder."
    );
    assertStudentVisibleTextIsSafe(reasoningEditTurn);

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
    const secondTemptingOptions = temptingOptionsForSelectedAnswer(
      secondItem,
      secondSelectedOption
    ).map((option) => option.label);
    assert(
      !secondTemptingOptions.includes(secondSelectedOption),
      "Tempting option choices should exclude the already selected answer."
    );
    assert(!secondTemptingOptions.includes("E"), "Tempting option choices should exclude E.");
    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: secondItem.item_public_id,
        data: {
          tempting_option: secondSelectedOption,
          client_action_id: `${prefix}_item2_same_tempting_rejected`
        }
      })
    ).state;
    assert(
      state.assessment_state === "AWAIT_TEMPTING_OPTION",
      "Selecting the same option as tempting should be rejected without advancing."
    );
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
    assert(state.package_results, "Initial package results should be visible after package completion.");
    assert(state.package_results.full_answer_revealed, "Correct answers should be revealed immediately after the initial package.");
    assert(
      state.package_results.items.length === 3,
      "Package results should include exactly the three administered initial items."
    );
    assert(
      state.package_results.items.every((item) =>
        item.answer_revealed &&
        item.revealed_answer &&
        item.answer_explanation_revealed &&
        item.answer_explanation &&
        item.answer_explanation.length > 20
      ),
      "Every administered item should show the correct answer and a concise explanation."
    );
    assert(
      !JSON.stringify(state.package_results).includes("item_mvp_irt_theta_invariance_transfer"),
      "Unadministered transfer-item keys must remain hidden from initial package results."
    );
    assert(
      !/teacher_diagnostic_context|distractor_rationales|possible_misconception_indicators|This option is correct because it is the correct answer|Available after this activity/i.test(
        JSON.stringify(state.package_results)
      ),
      "Package results should not expose raw teacher notes or generic delayed-reveal copy."
    );
    const refreshedState = await getStudentSessionState({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(
      refreshedState.package_results?.items.every((item) => item.revealed_answer && item.answer_explanation),
      "Answer reveal should persist after state reload."
    );
    const revealRows = await prisma.itemResponse.findMany({
      where: {
        concept_unit_session: {
          assessment_session: { session_public_id: started.session.session_public_id }
        }
      },
      select: {
        answer_explanation_revealed: true,
        revealed_at: true,
        reveal_trigger: true,
        explanation_version: true,
        student_display_acknowledged_at: true,
        item: {
          select: {
            included_in_published_set: true
          }
        }
      }
    });
    const administeredRevealRows = revealRows.filter((row) => row.item.included_in_published_set);
    assert(administeredRevealRows.length === 3, "Only the administered initial items should be reveal-marked.");
    assert(
      administeredRevealRows.every((row) =>
        row.answer_explanation_revealed &&
        row.revealed_at &&
        row.reveal_trigger === "initial_package_completed" &&
        row.explanation_version === "initial-package-answer-explanation-v1"
      ),
      "Reveal metadata should be persisted on administered item responses."
    );
    assert(
      ["explanation", "next_focus", "status", "updated_at"].every((key) => key in (state.learning_profile ?? {})),
      "Learning profile should expose one status, explanation, next-focus, and timestamp."
    );
    assert(
      !["Mostly understood", "Still developing", "Needs more work"].every((label) =>
        JSON.stringify(state.learning_profile).includes(label)
      ),
      "Learning profile should not show all three status categories simultaneously."
    );
    assert(
      ["Mostly understood", "Still developing", "Needs more work"].includes(state.learning_profile.status),
      "Learning profile should use an approved single status."
    );
    assert(state.learning_profile.explanation.length > 0, "Learning profile should include a short explanation.");
    assert(
      state.learning_profile.next_focus.trim().length > 0,
      "Learning profile should include one student-facing next-focus statement."
    );
    assert(
      !/\b(the student|they|their|engagement profile|engagement category|ai assistance|external assistance|formative need|metadata|structured output|agent call|integration pattern|internal integrated status)\b/i.test(
        JSON.stringify(state.learning_profile)
      ),
      "Learning profile should use direct student-facing wording without internal labels."
    );
    const persistedIntegrationProfile = await prisma.studentProfile.findFirst({
      where: {
        concept_unit_session: {
          assessment_session: { session_public_id: started.session.session_public_id }
        },
        item_level_evidence: {
          path: ["source"],
          equals: "profile_integration_interpretation"
        }
      },
      select: {
        item_level_evidence: true,
        recommended_next_evidence: true,
        based_on_agent_call_db_id: true
      }
    });
    assert(persistedIntegrationProfile, "Profile integration snapshot should be persisted.");
    assert(
      persistedIntegrationProfile.based_on_agent_call_db_id === null,
      "Deterministic profile integration display snapshot should not fabricate an agent-call link."
    );
    assert(
      JSON.stringify(persistedIntegrationProfile.item_level_evidence).includes("teacher_research_summary"),
      "Profile integration snapshot should preserve teacher/research inspection evidence."
    );
    assert(
      JSON.stringify(persistedIntegrationProfile.recommended_next_evidence).includes("student_safe_message"),
      "Profile integration snapshot should preserve the student-safe message separately."
    );
    const postPackageTranscript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    const postPackageText = postPackageTranscript.transcript.map((entry) => entry.message_text).join("\n");
    assert(postPackageText.trim().length > 0, "Post-package summary missing.");
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
    assert((counts.same_option_tempting_rejected ?? 0) > 0, "Same-option tempting rejection event missing.");
    assert((counts.student_response_edit_submitted ?? 0) > 0, "In-flow edit event missing.");
    assert((counts.reasoning_edited ?? 0) > 0, "Reasoning edit event missing.");
    assert((counts.clarification_answered ?? 0) > 0, "Clarification event missing.");
    assert((counts.profile_integration_interpreted ?? 0) > 0, "Profile integration event missing.");
    assert(
      (counts.student_safe_profile_projection_updated ?? 0) > 0,
      "Student-safe profile projection event missing."
    );
    assert(
      JSON.stringify(events.map((event) => event.payload)).includes('"item_admin_tutor_source":"deterministic_mock"'),
      "Item administration tutor source should be recorded in process-event evidence."
    );
    assert(
      JSON.stringify(events.map((event) => event.payload)).includes('"detected_response_language"'),
      "Detected response language should be recorded in response-quality audit evidence."
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
