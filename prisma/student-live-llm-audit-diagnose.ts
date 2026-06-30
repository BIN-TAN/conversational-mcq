import { PrismaClient } from "@prisma/client";
import { sanitizedAuditSummary, type LiveAuditCall } from "./student-live-llm-diagnostics";
import {
  LIVE_LLM_FAILURE_ARTIFACT_DIR,
  buildLiveLlmSmokeFailureArtifact,
  findLatestLiveLlmFailureArtifact,
  findLiveLlmFailureArtifact,
  readLiveLlmFailureArtifact,
  summarizeLiveLlmFailureArtifact
} from "./student-live-llm-failure-artifacts";

const prisma = new PrismaClient();

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name: string) {
  return process.argv.includes(name);
}

async function diagnoseArtifact(filePath: string) {
  const artifact = await readLiveLlmFailureArtifact(filePath);

  console.log(JSON.stringify({
    status: "found_in_artifact",
    diagnostic: summarizeLiveLlmFailureArtifact(artifact, filePath),
    artifact
  }, null, 2));
}

async function diagnoseSession(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    select: { session_public_id: true }
  });

  if (session) {
    const built = await buildLiveLlmSmokeFailureArtifact({
      prisma,
      sessionPublicId,
      stage: "diagnostic_db_session_inspection"
    });

    console.log(JSON.stringify({
      status: "found",
      diagnostic: {
        session_public_id: built.session_public_id,
        agent_call_id: built.agent_call_id,
        agent_name: built.agent_name,
        schema_version: built.schema_version,
        validation_status: built.validation_status
      },
      artifact_like_summary: built.artifact
    }, null, 2));
    return;
  }

  const artifactPath = await findLiveLlmFailureArtifact({ sessionPublicId });
  if (artifactPath) {
    await diagnoseArtifact(artifactPath);
    return;
  }

  console.log(JSON.stringify({
    status: "not_found",
    session_public_id: sessionPublicId,
    searched: {
      database_session: true,
      artifact_directory: LIVE_LLM_FAILURE_ARTIFACT_DIR
    },
    note:
      "No retained DB session or matching sanitized artifact was found. Rerun the opt-in live smoke; failures now retain the synthetic session and write a diagnostic artifact before cleanup."
  }, null, 2));
}

async function diagnoseAgentCall(agentCallId: string) {
  const call = await prisma.agentCall.findUnique({
    where: { id: agentCallId },
    select: {
      id: true,
      assessment_session_db_id: true,
      agent_name: true,
      schema_version: true,
      provider: true,
      model_name: true,
      live_call_allowed: true,
      output_payload: true,
      output_validated: true,
      validation_error: true,
      error_category: true,
      call_status: true,
      provider_request_id: true,
      provider_response_id: true,
      client_request_id: true,
      prompt_version: true,
      raw_output: true,
      token_usage: true,
      created_at: true,
      completed_at: true
    }
  });

  if (call) {
    const relatedCalls = call.assessment_session_db_id
      ? await prisma.agentCall.findMany({
          where: { assessment_session_db_id: call.assessment_session_db_id },
          orderBy: [{ created_at: "asc" }],
          select: {
            id: true,
            agent_name: true,
            schema_version: true,
            provider: true,
            model_name: true,
            live_call_allowed: true,
            output_payload: true,
            output_validated: true,
            validation_error: true,
            error_category: true,
            call_status: true,
            provider_request_id: true,
            provider_response_id: true,
            client_request_id: true,
            prompt_version: true,
            raw_output: true,
            token_usage: true,
            created_at: true,
            completed_at: true
          }
        })
      : [];

    console.log(JSON.stringify({
      status: "found",
      diagnostic: sanitizedAuditSummary(call as LiveAuditCall),
      relevant_agent_calls: relatedCalls.map((relatedCall) =>
        sanitizedAuditSummary(relatedCall as LiveAuditCall)
      )
    }, null, 2));
    return;
  }

  const artifactPath = await findLiveLlmFailureArtifact({ agentCallId });
  if (artifactPath) {
    await diagnoseArtifact(artifactPath);
    return;
  }

  console.log(JSON.stringify({
    status: "not_found",
    agent_call_id: agentCallId,
    searched: {
      database_agent_call: true,
      artifact_directory: LIVE_LLM_FAILURE_ARTIFACT_DIR
    },
    note:
      "The row is not present in the current local database and no matching sanitized artifact was found. Rerun the opt-in live smoke; failures now retain the synthetic session and write a diagnostic artifact before cleanup."
  }, null, 2));
}

async function main() {
  const artifact = argValue("--artifact");
  const sessionPublicId = argValue("--session-public-id") ?? argValue("--session");
  const agentCallId = argValue("--agent-call-id") ?? argValue("--id") ?? (
    !process.argv[2]?.startsWith("--") ? process.argv[2] : undefined
  );

  if (artifact) {
    await diagnoseArtifact(artifact);
    return;
  }

  if (hasArg("--latest-failure")) {
    const latestPath = await findLatestLiveLlmFailureArtifact();
    if (latestPath) {
      await diagnoseArtifact(latestPath);
      return;
    }

    const latestCall = await prisma.agentCall.findFirst({
      where: {
        provider: "openai",
        call_status: { in: ["failed", "invalid_output"] },
        OR: [
          { schema_version: "chat-native-formative-profile-output-v1" },
          { schema_version: "chat-native-formative-activity-evaluation-output-v1" }
        ]
      },
      orderBy: [{ created_at: "desc" }],
      select: { id: true }
    });

    if (latestCall) {
      await diagnoseAgentCall(latestCall.id);
      return;
    }

    console.log(JSON.stringify({
      status: "not_found",
      searched: {
        latest_artifact_directory: LIVE_LLM_FAILURE_ARTIFACT_DIR,
        latest_failed_live_formative_agent_call: true
      },
      note:
        "No latest live LLM smoke failure artifact or failed live formative agent call was found."
    }, null, 2));
    return;
  }

  if (sessionPublicId) {
    await diagnoseSession(sessionPublicId);
    return;
  }

  if (!agentCallId || agentCallId.startsWith("--")) {
    console.log(JSON.stringify({
      status: "usage",
      message:
        "Provide --agent-call-id <agent_call_id>, --session-public-id <session_public_id>, --latest-failure, or --artifact <path>. No prompts, raw outputs, or secrets are printed."
    }, null, 2));
    process.exitCode = 1;
    return;
  }
  await diagnoseAgentCall(agentCallId);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
