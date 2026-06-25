import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import type { AgentInputByName } from "../src/lib/agents/contracts";
import { executeOperationalAgent } from "../src/lib/agents/operational/executor";
import { persistOperationalEffectiveResult } from "../src/lib/agents/operational/effective-results";
import {
  activeOperationalConfigHash,
  verifyApprovedOperationalAgentConfig
} from "../src/lib/agents/operational/approved-config";
import {
  getGuardedOperationalAgentIntegrationReadiness,
  operationalReadinessHasFatalConfigurationBlock
} from "../src/lib/operational/guarded-agent-integration";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const prefix = `phase8a_operational_${randomUUID()}`;

const envKeys = [
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL_ITEM_VERIFICATION",
  "OPENAI_MODEL_RESPONSE_COLLECTION",
  "OPENAI_MODEL_PROFILING",
  "OPENAI_MODEL_PLANNING",
  "OPENAI_MODEL_FOLLOWUP",
  "OPENAI_REASONING_EFFORT_ITEM_VERIFICATION",
  "OPENAI_REASONING_EFFORT_RESPONSE_COLLECTION",
  "OPENAI_REASONING_EFFORT_PROFILING",
  "OPENAI_REASONING_EFFORT_PLANNING",
  "OPENAI_REASONING_EFFORT_FOLLOWUP",
  "OPERATIONAL_AGENT_MODE",
  "OPERATIONAL_APPROVED_CONFIG_HASH",
  "OPERATIONAL_AGENT_INTEGRATION_ENABLED"
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function setEnv(values: Partial<Record<(typeof envKeys)[number], string | undefined>>) {
  for (const key of envKeys) {
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
}

function syntheticResponseCollectionInput(): AgentInputByName["response_collection_agent"] {
  return {
    current_phase: "initial_item_administration" as const,
    allowed_interaction_type: "initial_free_text" as const,
    current_item_student_safe: {
      item_public_id: "synthetic_item",
      item_stem: "Which option best matches the generic pattern?",
      options: [
        { label: "A", text: "The values double." },
        { label: "B", text: "The values decrease." }
      ]
    },
    student_message: "I think option A because each value is twice the previous one.",
    collected_response_state: {
      selected_option: "A",
      confidence_rating: "medium"
    },
    missing_evidence_state: {
      missing_reasoning: true
    },
    recent_student_safe_transcript: [],
    orchestration_constraints: {
      no_correctness_feedback: true,
      no_hints_or_explanations: true
    },
    procedural_policy: {
      answer_and_confidence_backend_owned: true
    },
    allowed_student_controls: [
      "option_buttons",
      "confidence_controls",
      "free_text_message",
      "skip_reasoning_button",
      "skip_confidence_button",
      "skip_item_button",
      "save_exit_button",
      "submit_button"
    ]
  };
}

async function cleanup() {
  await prisma.operationalAgentEffectiveResult.deleteMany({
    where: { invocation_key: { startsWith: prefix } }
  });
  await prisma.agentCall.deleteMany({
    where: { agent_invocation_key: { startsWith: prefix } }
  });
}

async function run() {
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const evalRunCountBefore = await prisma.evalRun.count();
  const profileCountBefore = await prisma.studentProfile.count();
  const decisionCountBefore = await prisma.formativeDecision.count();
  const roundCountBefore = await prisma.followupRound.count();

  try {
    await cleanup();

    const manifest = verifyApprovedOperationalAgentConfig();
    assert(manifest.valid, "Approved operational manifest must match active registry.");
    assert(
      manifest.active_configuration_hash === manifest.manifest.approved_active_configuration_hash,
      "Active configuration hash must match the approved manifest."
    );

    setEnv({
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false",
      OPENAI_API_KEY: "",
      OPERATIONAL_AGENT_MODE: "disabled",
      OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined,
      OPERATIONAL_APPROVED_CONFIG_HASH: undefined
    });
    const disabledReadiness = await getGuardedOperationalAgentIntegrationReadiness({
      checkDatabase: true
    });
    assert(!disabledReadiness.allowed, "Disabled mode should not permit provider execution.");
    assert(
      disabledReadiness.block_reason === "operational_agent_mode_disabled",
      "Disabled mode should expose a sanitized block reason."
    );
    assert(
      !operationalReadinessHasFatalConfigurationBlock(disabledReadiness),
      "Disabled mode should be a fallback condition, not a fatal configuration error."
    );

    const blocked = await executeOperationalAgent({
      agentName: "response_collection_agent",
      invocationKey: `${prefix}:disabled_executor`,
      allowlistedInput: syntheticResponseCollectionInput(),
      operationalContext: {}
    });
    assert(blocked.status === "blocked_by_operational_guard", "Disabled executor should block before provider execution.");
    assert(
      (await prisma.agentCall.count({ where: { agent_invocation_key: `${prefix}:disabled_executor` } })) === 0,
      "Disabled executor must not create an agent call."
    );

    setEnv({
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false",
      OPENAI_API_KEY: "",
      OPERATIONAL_AGENT_MODE: "mock",
      OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined,
      OPERATIONAL_APPROVED_CONFIG_HASH: undefined
    });
    const mockReadiness = await getGuardedOperationalAgentIntegrationReadiness({
      checkDatabase: true
    });
    assert(mockReadiness.allowed, "Mock operational mode should be allowed with manifest verification.");
    const mockResult = await executeOperationalAgent({
      agentName: "response_collection_agent",
      invocationKey: `${prefix}:mock_executor`,
      allowlistedInput: syntheticResponseCollectionInput(),
      operationalContext: {},
      metadata: { mock_mode: "response_collection_reasoning_submission" }
    });
    assert(mockResult.status === "succeeded", "Mock operational executor should run through executeAgent.");
    assert(
      mockResult.status !== "succeeded" ||
        (await prisma.agentCall.findUniqueOrThrow({
          where: { agent_invocation_key: `${prefix}:mock_executor` }
        })).provider === "mock",
      "Mock operational execution must not create OpenAI calls."
    );

    const effectiveOne = await persistOperationalEffectiveResult({
      agent_name: "response_collection_agent",
      operational_context_type: "smoke",
      operational_context_public_id: "synthetic",
      invocation_key: `${prefix}:effective_idempotency`,
      raw_output_status: "blocked",
      raw_semantic_status: "not_run",
      effective_semantic_status: "pass",
      effective_overall_status: "fallback_safe",
      effective_student_facing_usable: true,
      effective_workflow_usable: true,
      fallback_applied: true,
      fallback_version: "smoke-fallback-v1",
      effective_output: { ok: true },
      effective_actions: { replay_safe: true },
      warnings: []
    });
    const effectiveTwo = await persistOperationalEffectiveResult({
      agent_name: "response_collection_agent",
      operational_context_type: "smoke",
      operational_context_public_id: "synthetic",
      invocation_key: `${prefix}:effective_idempotency`,
      raw_output_status: "blocked",
      raw_semantic_status: "not_run",
      effective_semantic_status: "pass",
      effective_overall_status: "fallback_safe",
      effective_student_facing_usable: true,
      effective_workflow_usable: true,
      fallback_applied: true,
      fallback_version: "smoke-fallback-v1",
      effective_output: { ok: true },
      effective_actions: { replay_safe: true },
      warnings: []
    });
    assert(effectiveOne.id === effectiveTwo.id, "Effective-result persistence should be idempotent.");

    const approvedHash = activeOperationalConfigHash();
    setEnv({
      LLM_PROVIDER: "openai",
      LLM_LIVE_CALLS_ENABLED: "true",
      OPENAI_API_KEY: "fake-key-never-sent",
      OPERATIONAL_AGENT_MODE: "guarded_live",
      OPERATIONAL_APPROVED_CONFIG_HASH: approvedHash,
      OPENAI_MODEL_ITEM_VERIFICATION: "gpt-5.4-mini-2026-03-17",
      OPENAI_MODEL_RESPONSE_COLLECTION: "gpt-5.4-mini-2026-03-17",
      OPENAI_MODEL_PROFILING: "gpt-5.4-mini-2026-03-17",
      OPENAI_MODEL_PLANNING: "gpt-5.4-mini-2026-03-17",
      OPENAI_MODEL_FOLLOWUP: "gpt-5.4-mini-2026-03-17",
      OPENAI_REASONING_EFFORT_ITEM_VERIFICATION: "low",
      OPENAI_REASONING_EFFORT_RESPONSE_COLLECTION: "low",
      OPENAI_REASONING_EFFORT_PROFILING: "low",
      OPENAI_REASONING_EFFORT_PLANNING: "low",
      OPENAI_REASONING_EFFORT_FOLLOWUP: "low"
    });
    const guardedReady = await getGuardedOperationalAgentIntegrationReadiness({
      checkDatabase: true
    });
    assert(guardedReady.allowed, "Guarded-live readiness should validate exact approved config.");
    assert(guardedReady.live_call_permitted, "Guarded-live readiness should mark live calls permitted.");

    setEnv({
      LLM_PROVIDER: "openai",
      LLM_LIVE_CALLS_ENABLED: "true",
      OPENAI_API_KEY: "fake-key-never-sent",
      OPERATIONAL_AGENT_MODE: "guarded_live",
      OPERATIONAL_APPROVED_CONFIG_HASH: "wrong-hash",
      OPENAI_MODEL_ITEM_VERIFICATION: "gpt-5.4-mini",
      OPENAI_MODEL_RESPONSE_COLLECTION: "gpt-5.4-mini",
      OPENAI_MODEL_PROFILING: "gpt-5.4-mini",
      OPENAI_MODEL_PLANNING: "gpt-5.4-mini",
      OPENAI_MODEL_FOLLOWUP: "gpt-5.4-mini"
    });
    const mismatch = await getGuardedOperationalAgentIntegrationReadiness({
      checkDatabase: true
    });
    assert(!mismatch.allowed, "Manifest or model mismatch should block guarded live.");
    assert(
      mismatch.blocking_reasons.includes("approved_config_hash_mismatch") ||
        mismatch.blocking_reasons.includes("approved_manifest_invalid"),
      "Mismatch should be reported as an approved configuration block."
    );

    const serializedAudit = JSON.stringify({
      disabledReadiness,
      mockReadiness,
      guardedReady,
      mismatch
    }).toLowerCase();
    for (const forbidden of ["fake-key-never-sent", "database_url", "session_secret", "password_hash", "access_code_hash"]) {
      assert(!serializedAudit.includes(forbidden), `Operational audit leaked ${forbidden}.`);
    }

    assert((await prisma.evalRun.count()) === evalRunCountBefore, "Operational smoke must not mutate eval runs.");
    assert((await prisma.studentProfile.count()) === profileCountBefore, "Operational smoke must not create profiles.");
    assert((await prisma.formativeDecision.count()) === decisionCountBefore, "Operational smoke must not create decisions.");
    assert((await prisma.followupRound.count()) === roundCountBefore, "Operational smoke must not create follow-up rounds.");

    console.log("Phase 8A operational smoke test passed. No OpenAI call was made.");
  } finally {
    setEnv(originalEnv);
    await cleanup();
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
