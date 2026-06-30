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
        validation_status: "blocked_after_validation_failure"
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
