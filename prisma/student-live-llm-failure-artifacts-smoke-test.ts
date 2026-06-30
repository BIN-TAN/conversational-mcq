import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
import { startOrResumeStudentAssessmentSession } from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  assert,
  cleanupSmokeStudentSessions,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";
import {
  buildLiveLlmSmokeFailureArtifact,
  findLatestLiveLlmFailureArtifact,
  findLiveLlmFailureArtifact,
  readLiveLlmFailureArtifact,
  sanitizeLiveLlmFailureArtifactForDiagnostic,
  summarizeLiveLlmFailureArtifact,
  writeLiveLlmSmokeFailureArtifact
} from "./student-live-llm-failure-artifacts";

const prisma = new PrismaClient();
const rawSecret = "sk-live-smoke-failure-artifact-secret-000000";
const rawStudentText = "This raw student response text must not be exported.";

function withTemporaryEnv<T>(values: Record<string, string | undefined>, callback: () => Promise<T>) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );

  return (async () => {
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
  })();
}

function safeMockRuntimeEnv() {
  return {
    ITEM_ADMIN_TUTOR_MODE: "mock",
    ALLOW_LOCAL_MOCK_RUNTIME: "true",
    LLM_PROVIDER: "mock",
    LLM_LIVE_CALLS_ENABLED: "false",
    OPENAI_API_KEY: "",
    OPENAI_API_KEY_FILE: "",
    OPENAI_MODEL_ITEM_ADMIN: "",
    OPENAI_MODEL_PLANNING: "",
    OPENAI_MODEL_FOLLOWUP: "",
    OPERATIONAL_AGENT_MODE: "disabled",
    ALLOW_MANUAL_REVIEW_STUDENT_STARTS: "true",
    NODE_ENV: "development"
  };
}

async function main() {
  await ensureDemoStudentAssessment(prisma);

  const prefix = `live_failure_artifact_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];
  let artifactPath: string | null = null;

  try {
    const started = await withTemporaryEnv(safeMockRuntimeEnv(), async () =>
      startOrResumeStudentAssessmentSession({
        student_user_db_id: student.id,
        assessment_public_id: demoAssessmentPublicId
      })
    );
    sessionPublicIds.push(started.session.session_public_id);
    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true, current_phase: true }
    });
    const agentCall = await prisma.agentCall.create({
      data: {
        id: randomUUID(),
        assessment_session_db_id: session.id,
        agent_name: "formative_value_and_planning_agent",
        agent_version: "student-live-llm-failure-artifact-smoke",
        model_name: "synthetic-openai-model",
        provider: "openai",
        provider_request_id: "req_failure_artifact_smoke",
        client_request_id: `client_${randomUUID()}`,
        agent_invocation_key: `failure_artifact_smoke_${randomUUID()}`,
        prompt_hash: "failure-artifact-smoke",
        prompt_version: "chat-native-formative-profile-v1",
        schema_version: "chat-native-formative-profile-output-v1",
        input_payload: { redacted: true },
        raw_output: {
          unsafe_raw_value: rawSecret,
          provider_failure: {
            error: {
              category: "schema_validation",
              type: "SyntheticValidationError",
              code: "invalid_enum_value",
              message: "Synthetic profile output used an invalid enum value."
            },
            transport: {
              http_status: 200,
              provider_error_code: null,
              typed_failure_reason: null,
              base_url_host: "api.openai.com"
            }
          }
        },
        output_payload: Prisma.JsonNull,
        output_validated: false,
        validation_error: JSON.stringify({
          category: "student_facing_validation",
          issue_count: 1,
          issues: [
            {
              field_path: "student_facing_text",
              path: "student_facing_text",
              rule_code: "unsafe_student_facing_text",
              code: "unsafe_student_facing_text",
              message: "student-facing text is too long for chat"
            }
          ]
        }),
        error_category: "schema_validation",
        live_call_allowed: true,
        call_status: "invalid_output",
        token_usage: {
          input_tokens: 10,
          output_tokens: 12,
          total_tokens: 22
        },
        started_at: new Date(),
        completed_at: new Date()
      }
    });
    await prisma.processEvent.create({
      data: {
        assessment_session_db_id: session.id,
        event_type: "llm_runtime_blocked",
        event_category: "formative_profile",
        event_source: "backend",
        payload: {
          agent_call_id: agentCall.id,
          validation_status: "blocked_after_validation_failure",
          validation_issue_count: 1,
          raw_student_response: rawStudentText
        },
        occurred_at: new Date()
      }
    });
    await prisma.conversationTurn.create({
      data: {
        assessment_session_db_id: session.id,
        phase: session.current_phase,
        actor_type: "student",
        agent_name: null,
        message_text: rawStudentText,
        structured_payload: {
          agent_call_id: agentCall.id,
          message_classification: "reasoning",
          response_quality: "needs_repair",
          should_advance: false,
          raw_student_response: rawStudentText
        }
      }
    });

    const failure = new StudentAssessmentServiceError(
      "llm_profile_validation_failed",
      "The assessment tutor is temporarily unavailable. Your progress is saved. Please try again in a moment or pause and return later.",
      409,
      {
        agent_call_id: agentCall.id,
        validation_status: "blocked_after_validation_failure",
        failure_stage: "formative_loop_state_mismatch",
        expected_states: ["NEXT_CHOICE"],
        actual_state: "FOLLOWUP_RESPONSE",
        last_action_attempted: "submit_followup_response",
        allowed_actions: ["submit_followup_response"],
        current_phase: "followup_active",
        effective_phase: "followup_active",
        next_step: "followup_active",
        loop_turns: 6,
        loop_history: [
          {
            turn_index: 0,
            from_state: "FOLLOWUP_RESPONSE",
            action: "submit_followup_response",
            to_state: "FOLLOWUP_RESPONSE",
            next_step: "followup_active"
          }
        ]
      }
    );
    const built = await buildLiveLlmSmokeFailureArtifact({
      prisma,
      sessionPublicId: started.session.session_public_id,
      stage: "formative_profile",
      error: failure
    });

    assert(built.agent_call_id === agentCall.id, "Artifact builder should identify the failed agent call.");
    assert(
      built.validation_status === "invalid_output",
      "Artifact builder should expose precise invalid-output validation status."
    );

    const written = await writeLiveLlmSmokeFailureArtifact({
      prisma,
      sessionPublicId: started.session.session_public_id,
      stage: "formative_profile",
      error: failure
    });
    artifactPath = written.file_path;
    const artifactText = await readFile(artifactPath, "utf8");
    assert(artifactText.includes("diagnostic_artifact") === false, "Artifact should be a data file, not CLI output.");
    assert(!artifactText.includes(rawSecret), "Failure artifact must not contain raw secret-like values.");
    assert(!artifactText.includes(rawStudentText), "Failure artifact must not contain raw student response text.");
    assert(
      artifactText.includes("student_facing_text"),
      "Failure artifact should preserve validation issue paths."
    );
    assert(
      artifactText.includes("unsafe_student_facing_text"),
      "Failure artifact should preserve validation rule codes."
    );
    assert(
      artifactText.includes("req_failure_artifact_smoke") === false,
      "Failure artifact should not expose provider request IDs."
    );
    assert(
      artifactText.includes("\"actual_state\": \"FOLLOWUP_RESPONSE\""),
      "Failure artifact should preserve safe actual-state details."
    );
    assert(
      artifactText.includes("\"expected_states\""),
      "Failure artifact should preserve safe expected-state details."
    );
    assert(
      artifactText.includes("\"last_action_attempted\": \"submit_followup_response\""),
      "Failure artifact should preserve the safe last attempted action."
    );
    const shapeFailure = new StudentAssessmentServiceError(
      "live_smoke_flow_mismatch",
      "Live smoke action did not return a full student state, and authoritative state refetch failed.",
      409,
      {
        failure_stage: "live_smoke_state_shape_error",
        expected_schema: "student_assessment_state",
        missing_paths: ["session_status", "assessment_state", "next_step"],
        returned_payload_keys: ["assistant_message", "message_status", "state"],
        last_action_attempted: "submit_followup_response",
        refetch_attempted: true,
        refetch_succeeded: false,
        resulting_state_if_refetched: null
      }
    );
    const shapeArtifact = await buildLiveLlmSmokeFailureArtifact({
      prisma,
      sessionPublicId: started.session.session_public_id,
      stage: "targeted_feedback_loop",
      error: shapeFailure
    });
    const shapeFailureSummary = (shapeArtifact.artifact.failure as Record<string, unknown>);
    const safeDetails = shapeFailureSummary.safe_details as Record<string, unknown>;
    assert(
      shapeFailureSummary.message === "Student assessment state shape validation failed.",
      "State-shape failure should use a generic safe diagnostic message."
    );
    assert(
      safeDetails.failure_stage === "live_smoke_state_shape_error",
      "State-shape artifact should preserve safe failure stage."
    );
    assert(
      Array.isArray(safeDetails.missing_paths) &&
        safeDetails.missing_paths.includes("assessment_state"),
      "State-shape artifact should preserve safe missing paths."
    );
    assert(
      Array.isArray(safeDetails.returned_payload_keys) &&
        safeDetails.returned_payload_keys.includes("message_status"),
      "State-shape artifact should preserve returned payload keys only."
    );
    assert(
      JSON.stringify(shapeArtifact.artifact).includes(rawStudentText) === false,
      "State-shape artifact must not contain raw student response text."
    );
    const legacyZodArtifact = {
      ...shapeArtifact.artifact,
      failure: {
        name: "ZodError",
        code: null,
        status: null,
        message: JSON.stringify([
          {
            code: "invalid_type",
            expected: "string",
            received: "undefined",
            path: ["assessment_state"],
            message: "Required"
          },
          {
            code: "invalid_type",
            expected: "string",
            received: "undefined",
            path: ["next_step"],
            message: "Required"
          }
        ]),
        agent_call_id: null,
        validation_status: null,
        details_keys: [],
        safe_details: {}
      }
    };
    const legacySummary = summarizeLiveLlmFailureArtifact(
      legacyZodArtifact as Record<string, unknown>,
      "/tmp/legacy-zod-artifact.json"
    );
    const legacyDiagnosticArtifact = sanitizeLiveLlmFailureArtifactForDiagnostic(
      legacyZodArtifact as Record<string, unknown>
    );
    assert(
      (legacySummary.failure as Record<string, unknown>).message ===
        "Student assessment state shape validation failed.",
      "Legacy Zod artifact summaries should use the generic state-shape message."
    );
    assert(
      JSON.stringify(legacyDiagnosticArtifact).includes("invalid_type") === false,
      "Diagnostic artifact output should not echo raw legacy Zod issue text."
    );
    assert(
      JSON.stringify(legacyDiagnosticArtifact).includes("assessment_state"),
      "Diagnostic artifact output should preserve safe missing state paths."
    );

    const byAgentCall = await findLiveLlmFailureArtifact({ agentCallId: agentCall.id });
    assert(byAgentCall === artifactPath, "Artifact lookup by agent_call_id should work.");
    const bySession = await findLiveLlmFailureArtifact({
      sessionPublicId: started.session.session_public_id
    });
    assert(bySession === artifactPath, "Artifact lookup by session_public_id should work.");
    const latest = await findLatestLiveLlmFailureArtifact();
    assert(Boolean(latest), "Latest-failure lookup should find the artifact.");

    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
    sessionPublicIds.length = 0;
    const deletedCall = await prisma.agentCall.findUnique({ where: { id: agentCall.id } });
    assert(!deletedCall, "Cleanup should remove the DB agent call for artifact fallback verification.");
    const fallbackArtifact = await findLiveLlmFailureArtifact({ agentCallId: agentCall.id });
    assert(fallbackArtifact === artifactPath, "Artifact fallback should work after DB cleanup.");
    const artifact = await readLiveLlmFailureArtifact(artifactPath);
    const summary = summarizeLiveLlmFailureArtifact(artifact, artifactPath);
    assert(summary.status === "artifact_found", "Artifact summary should be diagnostic-safe.");
    assert(summary.agent_call_id === agentCall.id, "Artifact summary should retain the opaque agent_call_id.");
    assert(
      (summary.failure as Record<string, unknown>).code === "llm_profile_validation_failed",
      "Artifact should preserve precise failure taxonomy."
    );
    assert(
      !(await findLiveLlmFailureArtifact({ agentCallId: "00000000-0000-0000-0000-000000000000" })),
      "Unknown agent_call_id should not match a failure artifact."
    );
  } finally {
    if (sessionPublicIds.length > 0) {
      await cleanupSmokeStudentSessions({
        prisma,
        userDbId: student.id,
        sessionPublicIds
      });
    }
    if (artifactPath) {
      await unlink(artifactPath).catch(() => undefined);
    }
  }

  console.log("Student live LLM failure-artifact smoke passed. No OpenAI call was made.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
