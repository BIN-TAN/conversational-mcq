import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import {
  assessmentInterpretationContextAuditMetadata,
  buildAssessmentInterpretationContextFromResponsePackage
} from "../src/lib/services/student-assessment/assessment-interpretation-context";
import { buildAbilityEvidencePacketForSession } from "../src/lib/services/student-assessment/ability-evidence";
import { buildEngagementEvidencePacketForSession } from "../src/lib/services/student-assessment/engagement-evidence";
import {
  buildProfileIntegrationAgentInput,
  executeLiveProfileIntegrationAgent
} from "../src/lib/services/student-assessment/profile-integration";
import { createFormativeValueSampleSession } from "./student-formative-value-helpers";
import { assert } from "./student-mvp-smoke-helpers";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

const REQUIRED_LIVE_ENV = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL_PROFILE_INTEGRATION"
] as const;

function missingLiveEnv() {
  return REQUIRED_LIVE_ENV.filter((key) => !process.env[key]);
}

async function main() {
  if (process.env.RUN_LIVE_LLM_FIRST_CONTEXT_SMOKE !== "1") {
    console.log(JSON.stringify({
      status: "skipped",
      reason: "Set RUN_LIVE_LLM_FIRST_CONTEXT_SMOKE=1 to run the paid live context smoke.",
      openai_calls_made: 0
    }, null, 2));
    await prisma.$disconnect();
    return;
  }

  const missing = missingLiveEnv();
  if (missing.length > 0) {
    throw new Error(`Live context smoke configuration missing: ${missing.join(", ")}`);
  }

  if (process.env.LLM_PROVIDER !== "openai" || process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
    throw new Error("Live context smoke requires LLM_PROVIDER=openai and LLM_LIVE_CALLS_ENABLED=true.");
  }

  const sample = await createFormativeValueSampleSession(prisma);

  try {
    const responsePackage = await prisma.responsePackage.findFirstOrThrow({
      where: {
        package_type: "initial_concept_unit_response_package",
        concept_unit_session: {
          assessment_session: {
            session_public_id: sample.session_public_id
          }
        }
      },
      orderBy: [{ created_at: "desc" }],
      select: { payload: true }
    });
    const context = buildAssessmentInterpretationContextFromResponsePackage({
      response_package_payload: responsePackage.payload,
      phase: "post_initial_interpretation"
    });
    const audit = assessmentInterpretationContextAuditMetadata(context);
    assert(context.items.length === 3, "Live context smoke should use the bounded synthetic three-item package.");
    assert(audit.teacher_diagnostic_context_present, "Teacher diagnostic context must be present.");
    assert(audit.context_version_bound, "Context must be version-bound.");
    assert(audit.student_visible_protected_content_exposed === false, "Context audit must remain student-safe.");

    const [abilityPacket, engagementPacket] = await Promise.all([
      buildAbilityEvidencePacketForSession(sample.session_public_id),
      buildEngagementEvidencePacketForSession(sample.session_public_id)
    ]);
    const agentInput = buildProfileIntegrationAgentInput({
      ability_packet: abilityPacket,
      engagement_packet: engagementPacket,
      assessment_interpretation_context: context
    });
    const result = await executeLiveProfileIntegrationAgent({
      agent_input: agentInput,
      session_public_id: sample.session_public_id
    });
    assert(result.agent_call_id, "Live context smoke should persist an agent call.");

    const agentCall = await prisma.agentCall.findUniqueOrThrow({
      where: { id: result.agent_call_id },
      select: {
        agent_name: true,
        call_status: true,
        output_validated: true,
        input_payload: true,
        provider: true,
        provider_request_id: true,
        provider_response_id: true,
        input_tokens: true,
        output_tokens: true,
        total_tokens: true
      }
    });
    const inputPayload = agentCall.input_payload as Record<string, unknown>;
    assert(agentCall.provider === "openai", "Live context smoke should use OpenAI provider.");
    assert(agentCall.provider_request_id || agentCall.provider_response_id, "Provider metadata must be persisted.");
    assert(
      typeof agentCall.total_tokens === "number" ||
        typeof agentCall.input_tokens === "number" ||
        typeof agentCall.output_tokens === "number",
      "Token usage must be persisted."
    );
    assert(Boolean(inputPayload.assessment_interpretation_context), "Agent input should include shared context.");
    assert(Boolean(inputPayload.assessment_context_audit), "Agent input should include context audit metadata.");
    assert(result.status === "succeeded", `Live context smoke failed: ${result.status}`);

    console.log(JSON.stringify({
      status: "passed",
      session_public_id: sample.session_public_id,
      agent_name: agentCall.agent_name,
      call_status: agentCall.call_status,
      output_validated: agentCall.output_validated,
      context_schema_version: context.schema_version,
      context_hash: audit.assessment_context_hash,
      provider_metadata_present: Boolean(agentCall.provider_request_id || agentCall.provider_response_id),
      token_usage_present: Boolean(agentCall.total_tokens ?? agentCall.input_tokens ?? agentCall.output_tokens),
      paid_provider_calls_made: 1
    }, null, 2));
  } finally {
    await sample.cleanup();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect();
  console.error(error);
  process.exit(1);
});
