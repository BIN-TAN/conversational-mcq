import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/db";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_AGENT_NAME
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import type { FormativeConversationAgentRunner } from "../src/lib/services/student-assessment/formative-conversation/runtime";
import { withOpenAIResponsesTransportBoundaryObserver } from "../src/lib/llm/providers/openai-responses-provider";
import {
  SYNTHETIC_STUDENT_PERSONAS,
  SyntheticStudentPersonaSchema,
  cleanupSyntheticStudentValidationRun,
  runSyntheticStudentResearchValidation
} from "../src/lib/evaluation/synthetic-student-validation";

loadEnvConfig(process.cwd());

const runPublicId = `synthetic_validation_smoke_${Date.now()}`;
const ENV_KEYS = [
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPERATIONAL_AGENT_MODE",
  "RESEARCH_PSEUDONYMIZATION_KEY",
  "RESEARCH_PSEUDONYMIZATION_VERSION"
] as const;

function contractRunner(): FormativeConversationAgentRunner {
  return {
    identity: {
      agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
      agent_version: "synthetic-validation-contract-runner-v1",
      model_name: "no-provider-contract-fixture",
      provider: "mock",
      prompt_version: "synthetic-validation-contract-runner-v1",
      schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      prompt_hash: createHash("sha256")
        .update("synthetic-validation-contract-runner-v1")
        .digest("hex"),
      reasoning_effort: null,
      max_output_tokens: 500,
      live_call_allowed: false
    },
    async execute({ context }) {
      const startedAt = new Date();
      const completedAt = new Date(startedAt.getTime() + 5);
      const opening = context.latest_student_message === null;
      return {
        output: {
          contract_version:
            FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
          student_visible_message: opening
            ? "We can use your reviewed answers as the starting point for this conversation."
            : "This contract fixture records the exchange without making a learning-outcome judgment.",
          teaching_artifact: null,
          evidence_observations: [],
          profile_transition_recommendation: null,
          teacher_assistance_recommendation: {
            recommended: false,
            reason_code: null
          },
          lifecycle_recommendation: "continue"
        },
        raw_output: {
          fixture_type: "no_provider_contract_validation"
        },
        generation_source: "deterministic_test",
        provider_request_id: null,
        provider_response_id: null,
        client_request_id: null,
        retry_count: 0,
        latency_ms: 5,
        input_tokens: 10,
        output_tokens: 10,
        total_tokens: 20,
        estimated_cost: 0,
        started_at: startedAt,
        completed_at: completedAt
      };
    }
  };
}

async function main() {
  const previousEnv = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]])
  );
  let transportBoundaryCount = 0;

  try {
    process.env.LLM_PROVIDER = "mock";
    process.env.LLM_LIVE_CALLS_ENABLED = "false";
    process.env.OPERATIONAL_AGENT_MODE = "mock";
    process.env.RESEARCH_PSEUDONYMIZATION_KEY =
      "synthetic-validation-smoke-pseudonym-key";
    process.env.RESEARCH_PSEUDONYMIZATION_VERSION = "hmac_sha256_v1";

    assert.equal(SYNTHETIC_STUDENT_PERSONAS.length, 6);
    for (const persona of SYNTHETIC_STUDENT_PERSONAS) {
      assert(SyntheticStudentPersonaSchema.safeParse(persona).success);
      const serialized = JSON.stringify(persona);
      assert(!serialized.includes("expected_outcome"));
      assert(!serialized.includes("target_profile"));
      assert(!serialized.includes("fixed_tutor_response"));
    }

    const runner = contractRunner();
    const result =
      await withOpenAIResponsesTransportBoundaryObserver(
        () => {
          transportBoundaryCount += 1;
        },
        () =>
          runSyntheticStudentResearchValidation({
            mode: "contract_test",
            personas: SYNTHETIC_STUDENT_PERSONAS,
            run_public_id: runPublicId,
            runner_factory: () => runner
          })
      );

    assert.equal(transportBoundaryCount, 0);
    assert.equal(result.report.persona_count, 6);
    assert.equal(result.report.mode, "contract_test");
    assert.equal(result.report.pedagogical_evaluation_valid, false);
    assert.equal(result.report.provider_calls_authorized, false);
    assert.equal(
      result.report.export_validation.status,
      "passed",
      JSON.stringify(result.report.export_validation)
    );
    assert.equal(
      result.report.export_validation.required_files_present,
      true
    );
    assert.equal(
      result.report.export_validation.timeline_reconstructable,
      true
    );
    assert.equal(
      result.report.export_validation.agent_call_joins_valid,
      true
    );
    assert.equal(
      result.report.export_validation.profile_provenance_valid,
      true
    );
    assert.equal(result.report.export_validation.reproducible, true);

    for (const student of result.report.students) {
      assert(student.initial_profile);
      assert.equal(student.conversation_length.student_turns, 3);
      assert.equal(student.conversation_length.tutor_turns, 4);
      assert.equal(student.agent_calls.total, 4);
      assert.equal(student.agent_calls.failed, 0);
      assert.equal(student.telemetry_summary.input_telemetry_count, 3);
      assert.equal(student.final_profile_transition, null);
      assert.equal(student.execution_error, null);
    }

    const sessionPublicIds = result.report.students.map(
      (student) => student.session_public_id
    );
    const assessmentSessionIds = (
      await prisma.assessmentSession.findMany({
        where: {
          session_public_id: { in: sessionPublicIds }
        },
        select: { id: true }
      })
    ).map((session) => session.id);
    assert.equal(
      await prisma.activityRuntimeAttempt.count({
        where: { session_public_id: { in: sessionPublicIds } }
      }),
      0
    );
    assert.equal(
      await prisma.topicDialogue.count({
        where: {
          assessment_session_db_id: { in: assessmentSessionIds }
        }
      }),
      0
    );
    assert(result.research_export.buffer.length > 0);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          smoke: "student-synthetic-research-validation",
          persona_count: result.report.persona_count,
          provider_calls: transportBoundaryCount,
          export_validation:
            result.report.export_validation.status,
          assertions: [
            "six_configurable_personas",
            "assessment_evidence_and_process_telemetry_persisted",
            "assistant_first_formative_conversation_persisted",
            "agent_calls_and_turn_telemetry_bound",
            "teacher_trajectory_projected",
            "research_export_complete_and_reproducible",
            "safe_agent_call_joins",
            "profile_provenance_validator",
            "no_expected_learning_outcomes",
            "no_activity_routing",
            "no_openai_transport"
          ]
        },
        null,
        2
      )
    );
  } finally {
    await cleanupSyntheticStudentValidationRun(runPublicId);
    for (const key of ENV_KEYS) {
      const value = previousEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
