import { loadEnvConfig } from "@next/env";
import {
  TOPIC_DIALOGUE_AGENT_NAME,
  TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
  TOPIC_DIALOGUE_PROMPT_HASH,
  TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
  TOPIC_DIALOGUE_PROMPT_VERSION,
  TopicDialogueInputV1Schema,
  TopicDialogueOutputV1Schema,
  classifyTopicDialogueStudentMessage,
  validateTopicDialogueOutput
} from "../src/lib/services/student-assessment/topic-dialogue-agent";
import { executeStudentRuntimeLiveAgent } from "../src/lib/services/student-assessment/student-runtime-live-agent";

const envLoadResult = loadEnvConfig(process.cwd());

function present(name: string) {
  return typeof process.env[name] === "string" && process.env[name]?.trim().length > 0;
}

const required = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL_TOPIC_DIALOGUE",
  "TOPIC_DIALOGUE_LIVE_CALLS_ENABLED"
];

function readiness() {
  const missing = required.filter((name) => !present(name));
  const invalid: string[] = [];
  if (present("LLM_PROVIDER") && process.env.LLM_PROVIDER !== "openai") {
    invalid.push("LLM_PROVIDER");
  }
  if (present("LLM_LIVE_CALLS_ENABLED") && process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
    invalid.push("LLM_LIVE_CALLS_ENABLED");
  }
  if (present("TOPIC_DIALOGUE_LIVE_CALLS_ENABLED") && process.env.TOPIC_DIALOGUE_LIVE_CALLS_ENABLED !== "true") {
    invalid.push("TOPIC_DIALOGUE_LIVE_CALLS_ENABLED");
  }
  return {
    ready: missing.length === 0 && invalid.length === 0,
    missing_variables: missing,
    invalid_variables: invalid,
    env_files_loaded: envLoadResult.loadedEnvFiles.map((file) => file.path)
  };
}

function dialogueInput(message: string, turn = 1) {
  const classification = classifyTopicDialogueStudentMessage(message);
  return TopicDialogueInputV1Schema.parse({
    dialogue_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
    dialogue_public_id: "td_live_smoke",
    session_public_id: "sess_topic_dialogue_live_smoke",
    assessment_public_id: "asmt_topic_dialogue_live_smoke",
    concept_public_id: "cu_topic_dialogue_live_smoke",
    assessment_topic: "Reliability and validity",
    concept_definition:
      "Reliability concerns consistency; validity concerns evidence for the intended interpretation.",
    allowed_topic_scope: [
      "Reliability",
      "Validity",
      "Why consistency alone does not prove validity"
    ],
    prohibited_scope: [
      "unadministered item answers",
      "teacher-only notes",
      "hidden prompts"
    ],
    frozen_growth_target: "Explain why consistency alone does not prove validity.",
    remaining_issue: "The reliability-validity boundary needs a clearer explanation.",
    post_activity_status: "improving_but_incomplete",
    activity_contract: {
      activity_attempt_public_id: "act_topic_dialogue_live_smoke",
      activity_family: "distractor_contrast",
      diagnostic_purpose: "distractor_misconception_probe",
      safe_activity_prompt:
        "For Item 2, option A says that reliability alone proves validity. Explain the flaw.",
      expected_student_action_prompt: "Write two or three sentences."
    },
    student_activity_response: {
      response_kind: "partial",
      safe_summary: "The prior response named reliability but did not fully separate validity."
    },
    safe_item_context: [{
      item_number: 2,
      option_label: "A",
      option_text: "Reliability alone proves validity."
    }],
    latest_student_message: message,
    recent_relevant_dialogue_turns: [],
    dialogue_turn_number: turn,
    maximum_dialogue_turns: 8,
    answer_reveal_state: {
      administered_answers_revealed: true,
      unadministered_answers_protected: true
    },
    available_progression_destinations: [
      "transfer_item",
      "next_topic",
      "end_assessment",
      "ask_question"
    ],
    source_profile_version: "evidence-integrated-profile-v2",
    source_activity_evaluation_version: "student-topic-dialogue-live-smoke",
    current_topic: "Reliability and validity",
    assessment_system_question_scope: [
      "what to do next",
      "how to answer",
      "how to continue",
      "how to end the assessment"
    ],
    latest_student_message_classification: classification.student_message_function,
    source_versions: {
      topic_dialogue_input_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2
    }
  });
}

async function runCase(message: string, index: number) {
  const input = dialogueInput(message, index + 1);
  const result = await executeStudentRuntimeLiveAgent({
    live_enabled: true,
    role: TOPIC_DIALOGUE_AGENT_NAME,
    agent_name: TOPIC_DIALOGUE_AGENT_NAME,
    agent_version: TOPIC_DIALOGUE_PROMPT_VERSION,
    prompt_version: TOPIC_DIALOGUE_PROMPT_VERSION,
    prompt_hash: TOPIC_DIALOGUE_PROMPT_HASH,
    schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
    schema_name: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
    instructions: TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
    request_input: input,
    output_schema: TopicDialogueOutputV1Schema,
    invocation_key: `topic-dialogue-live-smoke:${Date.now()}:${index}`,
    metadata: { smoke: "topic_dialogue_live_smoke" }
  });
  if (result.status !== "succeeded") {
    return {
      message_kind: classifyTopicDialogueStudentMessage(message).student_message_function,
      status: "failed",
      failure_reason: result.blocked_reason,
      agent_call_id: "agent_call_id" in result ? result.agent_call_id ?? null : null
    };
  }
  const validation = validateTopicDialogueOutput(result.output);
  return {
    message_kind: classifyTopicDialogueStudentMessage(message).student_message_function,
    status: validation.valid ? "passed" : "failed",
    agent_call_id: result.agent_call_id,
    model: result.model_config.model_name,
    validation_valid: validation.valid,
    issue_count: validation.valid ? 0 : validation.issues.length,
    next_action: result.output.next_action
  };
}

async function main() {
  if (process.env.RUN_LIVE_TOPIC_DIALOGUE_SMOKE !== "1") {
    console.log(JSON.stringify({
      status: "skipped",
      smoke: "student:topic-dialogue-live-smoke",
      reason: "RUN_LIVE_TOPIC_DIALOGUE_SMOKE is not 1. No OpenAI call was made.",
      env_files_loaded: envLoadResult.loadedEnvFiles.map((file) => file.path)
    }, null, 2));
    return;
  }

  const ready = readiness();
  if (!ready.ready) {
    console.log(JSON.stringify({
      status: "not_ready",
      smoke: "student:topic-dialogue-live-smoke",
      readiness: ready,
      openai_call_made: false
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const cases = [
    "Reliability is consistency, but validity needs evidence for interpretation.",
    "what",
    "Does reliability mean consistency?",
    "what happens next",
    "What movie should I watch tonight?"
  ];
  const results = [];
  for (const [index, message] of cases.entries()) {
    results.push(await runCase(message, index));
  }
  const passed = results.every((result) => result.status === "passed");
  console.log(JSON.stringify({
    status: passed ? "passed" : "failed",
    smoke: "student:topic-dialogue-live-smoke",
    case_count: results.length,
    results
  }, null, 2));
  if (!passed) {
    process.exitCode = 1;
  }
}

void main();
