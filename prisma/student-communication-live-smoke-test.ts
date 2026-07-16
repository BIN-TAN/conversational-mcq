import { loadEnvConfig } from "@next/env";
import {
  STUDENT_COMMUNICATION_AGENT_NAME,
  STUDENT_COMMUNICATION_INPUT_SCHEMA_VERSION,
  STUDENT_COMMUNICATION_OUTPUT_SCHEMA_VERSION,
  STUDENT_COMMUNICATION_PROMPT_HASH,
  STUDENT_COMMUNICATION_PROMPT_INSTRUCTIONS,
  STUDENT_COMMUNICATION_PROMPT_VERSION,
  StudentCommunicationInputV1Schema,
  StudentCommunicationOutputV1Schema,
  validateStudentCommunicationLanguage,
  validateStudentCommunicationOutputFacts
} from "../src/lib/services/student-assessment/student-communication-agent";
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
  "OPENAI_MODEL_STUDENT_COMMUNICATION",
  "STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED"
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
  if (
    present("STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED") &&
    process.env.STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED !== "true"
  ) {
    invalid.push("STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED");
  }
  return {
    ready: missing.length === 0 && invalid.length === 0,
    missing_variables: missing,
    invalid_variables: invalid,
    env_files_loaded: envLoadResult.loadedEnvFiles.map((file) => file.path)
  };
}

function communicationInput() {
  return StudentCommunicationInputV1Schema.parse({
    communication_input_schema_version: STUDENT_COMMUNICATION_INPUT_SCHEMA_VERSION,
    session_public_id: "sess_student_communication_live_smoke",
    package_public_id: "pkg_student_communication_live_smoke",
    communication_purpose: "initial_package_results",
    administered_item_summaries: [
      {
        item_number: 1,
        item_public_id: "item_student_communication_live_smoke_1",
        status_label: "Correct",
        student_answer_label: "C",
        correct_answer_label: "C",
        answer_explanation:
          "A high internal-consistency coefficient supports score consistency, but it does not by itself establish that scores support the intended interpretation.",
        distractor_boundary:
          "Reliability evidence can support score use, but it cannot independently prove validity."
      }
    ],
    validated_outcome_summary: {
      items_administered: 1,
      items_correct: 1,
      initial_results: "1 of 1"
    },
    validated_understanding_summary: {
      status: "Mostly understood",
      student_label: "Mostly understood",
      safe_explanation: "Your response separated consistency from interpretation evidence."
    },
    validated_reasoning_summary: {
      student_label: "Your explanations",
      safe_explanation: "Your explanation used the main reliability-validity boundary."
    },
    validated_confidence_summary: {
      student_label: "How sure you were",
      safe_explanation: "Your confidence mostly matched the evidence in your explanation."
    },
    validated_evidence_limitations: ["This summary uses only this short smoke-test package."],
    validated_growth_target: {
      student_facing_text: "Explain why consistency alone does not prove validity.",
      compatible_activity_types: ["identify_specific_flaw"]
    },
    validated_item_explanations: [{
      item_number: 1,
      why_correct:
        "A reliability coefficient supports consistency, while validity requires evidence for the intended interpretation.",
      distractor_boundary:
        "The tempting claim treats consistency as if it were the same as validity evidence."
    }],
    validated_activity_contract: {
      activity_family: "distractor_contrast",
      activity_type: "identify_specific_flaw",
      source_item_number: 1,
      source_option_label: "A",
      source_option_text: "A high reliability coefficient proves validity.",
      expected_response_format: "Write two or three sentences.",
      next_runtime_state: "FORMATIVE_ACTIVITY",
      prompt:
        "Identify the exact flaw in option A, then rewrite the claim so it becomes accurate."
    },
    answer_reveal_state: {
      full_answer_key_revealed: false,
      may_show_correct_options_for_administered_items: true
    },
    language: "en",
    reading_level_target: "undergraduate_plain_english",
    maximum_length_constraints: {
      initial_results_intro_max_chars: 220,
      summary_max_chars: 700,
      activity_prompt_max_chars: 900,
      completion_message_max_chars: 220
    },
    source_profile_version: "evidence-integrated-profile-v2",
    source_activity_version: "student-communication-live-smoke"
  });
}

async function main() {
  if (process.env.RUN_LIVE_STUDENT_COMMUNICATION_SMOKE !== "1") {
    console.log(JSON.stringify({
      status: "skipped",
      smoke: "student:student-communication-live-smoke",
      reason: "RUN_LIVE_STUDENT_COMMUNICATION_SMOKE is not 1. No OpenAI call was made.",
      env_files_loaded: envLoadResult.loadedEnvFiles.map((file) => file.path)
    }, null, 2));
    return;
  }

  const ready = readiness();
  if (!ready.ready) {
    console.log(JSON.stringify({
      status: "not_ready",
      smoke: "student:student-communication-live-smoke",
      readiness: ready,
      openai_call_made: false
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const input = communicationInput();
  const result = await executeStudentRuntimeLiveAgent({
    live_enabled: true,
    role: STUDENT_COMMUNICATION_AGENT_NAME,
    agent_name: STUDENT_COMMUNICATION_AGENT_NAME,
    agent_version: STUDENT_COMMUNICATION_PROMPT_VERSION,
    prompt_version: STUDENT_COMMUNICATION_PROMPT_VERSION,
    prompt_hash: STUDENT_COMMUNICATION_PROMPT_HASH,
    schema_version: STUDENT_COMMUNICATION_OUTPUT_SCHEMA_VERSION,
    schema_name: STUDENT_COMMUNICATION_OUTPUT_SCHEMA_VERSION,
    instructions: STUDENT_COMMUNICATION_PROMPT_INSTRUCTIONS,
    request_input: input,
    output_schema: StudentCommunicationOutputV1Schema,
    invocation_key: `student-communication-live-smoke:${Date.now()}`,
    metadata: { smoke: "student_communication_live_smoke" }
  });

  if (result.status !== "succeeded") {
    console.log(JSON.stringify({
      status: "failed",
      smoke: "student:student-communication-live-smoke",
      failure_reason: result.blocked_reason,
      agent_call_id: "agent_call_id" in result ? result.agent_call_id ?? null : null
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const factValidation = validateStudentCommunicationOutputFacts({
    frozen_input: input,
    output: result.output
  });
  const languageValidation = validateStudentCommunicationLanguage(result.output);
  const passed = factValidation.valid && languageValidation.valid;
  console.log(JSON.stringify({
    status: passed ? "passed" : "failed",
    smoke: "student:student-communication-live-smoke",
    agent_call_id: result.agent_call_id,
    model: result.model_config.model_name,
    fact_validation_valid: factValidation.valid,
    language_validation_valid: languageValidation.valid,
    issue_count: factValidation.issues.length + languageValidation.issues.length
  }, null, 2));
  if (!passed) {
    process.exitCode = 1;
  }
}

void main();
