import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import type { AgentInputByName } from "../src/lib/agents/contracts";
import { executeOperationalAgent } from "../src/lib/agents/operational/executor";
import { persistOperationalEffectiveResult } from "../src/lib/agents/operational/effective-results";
import {
  activeOperationalConfigHash,
  readActiveApprovedOperationalRuntimeConfig,
  verifyApprovedOperationalAgentConfig
} from "../src/lib/agents/operational/approved-config";
import { approvedRoleEnvironmentAssertions } from "../src/lib/llm/config";
import { APPROVED_OPERATIONAL_ROLE_NAMES } from "../src/lib/operational/active-approval-bundle";
import {
  getGuardedOperationalAgentIntegrationReadiness,
  operationalReadinessHasFatalConfigurationBlock
} from "../src/lib/operational/guarded-agent-integration";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const prefix = `phase8a_operational_${randomUUID()}`;
const suiteArg = process.argv.includes("--suite")
  ? process.argv[process.argv.indexOf("--suite") + 1]
  : "all";

const activeRuntimeAtStart = readActiveApprovedOperationalRuntimeConfig();
const approvedRuntimeEnvironmentAssertions = activeRuntimeAtStart.kind === "derived_approval"
  ? approvedRoleEnvironmentAssertions(activeRuntimeAtStart.active_bundle.manifest)
  : {};
const envKeys = [...new Set([
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
  "OPERATIONAL_AGENT_INTEGRATION_ENABLED",
  ...Object.keys(approvedRuntimeEnvironmentAssertions)
])];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function setEnv(values: Partial<Record<string, string | undefined>>) {
  for (const key of envKeys) {
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
}

function assertIssue(
  verification: ReturnType<typeof verifyApprovedOperationalAgentConfig>,
  code: string
) {
  assert(
    verification.issues.some((issue) => issue.code === code),
    `Expected manifest verification issue ${code}.`
  );
}

function assertApprovalManifestVerification() {
  const manifest = verifyApprovedOperationalAgentConfig();
  const activeRuntime = readActiveApprovedOperationalRuntimeConfig();
  assert(manifest.valid, "Approved operational manifest must match active registry.");
  assert(
    manifest.active_configuration_hash === activeRuntime.approved_active_configuration_hash,
    "Active configuration hash must match the approved manifest."
  );
  assert(
    manifest.role_inventory.length === (activeRuntime.kind === "derived_approval" ? 17 : 5),
    "Manifest verification should cover the complete active approval architecture."
  );

  const roleNames = activeRuntime.kind === "derived_approval"
    ? APPROVED_OPERATIONAL_ROLE_NAMES
    : [
        "item_verification_agent",
        "response_collection_agent",
        "student_profiling_agent",
        "formative_value_and_planning_agent",
        "followup_agent"
      ] as const;
  for (const agentName of roleNames) {
    const resolved = manifest.runtime_model_resolution[agentName];
    const approved = activeRuntime.roles[agentName];
    assert(resolved, `${agentName} should have runtime model-resolution diagnostics.`);
    assert(approved, `${agentName} should exist in the approved manifest.`);
    assert(
      resolved.source === "approvedOperationalModelConfigForAgent" ||
        resolved.source === "approved_derived_bundle" ||
        resolved.source === "active_approval_bundle",
      `${agentName} should resolve through the operational executor model-config source.`
    );
    assert(
      resolved.resolved_model_snapshot === approved.model_name,
      `${agentName} runtime model should match approved snapshot.`
    );
    assert(
      resolved.resolved_reasoning_effort === approved.reasoning_effort,
      `${agentName} runtime reasoning effort should match approved value.`
    );
    assert(
      resolved.resolved_max_output_tokens === approved.max_output_tokens,
      `${agentName} runtime token limit should match approved value.`
    );
  }

  const wrongModel = verifyApprovedOperationalAgentConfig({
    runtimeModelConfigOverridesForTest: {
      response_collection_agent: {
        model_name: "gpt-5.4-mini",
        source: "test_override"
      }
    }
  });
  assert(!wrongModel.valid, "Wrong global model snapshot should fail field validation.");
  assertIssue(wrongModel, "model_snapshot_mismatch");
  assert(
    wrongModel.active_configuration_hash === manifest.active_configuration_hash,
    "Matching active/approved hashes alone must not bypass runtime model validation."
  );

  const wrongReasoning = verifyApprovedOperationalAgentConfig({
    runtimeModelConfigOverridesForTest: {
      followup_agent: {
        reasoning_effort: activeRuntime.roles.followup_agent?.reasoning_effort === "high"
          ? "medium"
          : "high",
        source: "test_override"
      }
    }
  });
  assert(!wrongReasoning.valid, "Wrong reasoning effort should fail field validation.");
  assertIssue(wrongReasoning, "reasoning_effort_mismatch");

  const missingModel = verifyApprovedOperationalAgentConfig({
    runtimeModelConfigOverridesForTest: {
      student_profiling_agent: {
        model_name: null,
        source: "test_override"
      }
    }
  });
  assert(!missingModel.valid, "Missing model configuration should fail field validation.");
  assertIssue(
    missingModel,
    activeRuntime.kind === "derived_approval"
      ? "model_snapshot_mismatch"
      : "model_snapshot_missing"
  );

  const missingReasoning = verifyApprovedOperationalAgentConfig({
    runtimeModelConfigOverridesForTest: {
      formative_value_and_planning_agent: {
        reasoning_effort: null,
        source: "test_override"
      }
    }
  });
  assert(!missingReasoning.valid, "Missing reasoning configuration should fail field validation.");
  assertIssue(
    missingReasoning,
    activeRuntime.kind === "derived_approval"
      ? "reasoning_effort_mismatch"
      : "reasoning_effort_missing"
  );

  if (activeRuntime.kind === "phase8a_legacy") {
    const promptHashMismatch = verifyApprovedOperationalAgentConfig({
      activeAgentConfigOverridesForTest: {
        item_verification_agent: {
          prompt_hash: "wrong-prompt-hash"
        }
      }
    });
    assert(!promptHashMismatch.valid, "Prompt hash mismatch should fail.");
    assertIssue(promptHashMismatch, "active_agent_config_mismatch");

    const schemaMismatch = verifyApprovedOperationalAgentConfig({
      activeAgentConfigOverridesForTest: {
        response_collection_agent: {
          schema_version: "wrong-schema-version"
        }
      }
    });
    assert(!schemaMismatch.valid, "Schema version mismatch should fail.");
    assertIssue(schemaMismatch, "active_agent_config_mismatch");

    const tokenMismatch = verifyApprovedOperationalAgentConfig({
      activeAgentConfigOverridesForTest: {
        followup_agent: {
          max_output_tokens: 999
        }
      }
    });
    assert(!tokenMismatch.valid, "Token-limit mismatch should fail.");
    assertIssue(tokenMismatch, "active_agent_config_mismatch");
  }

  const runtimeTokenMismatch = verifyApprovedOperationalAgentConfig({
    runtimeModelConfigOverridesForTest: {
      followup_agent: {
        max_output_tokens: 999,
        source: "test_override"
      }
    }
  });
  assert(!runtimeTokenMismatch.valid, "Runtime token-limit mismatch should fail.");
  assertIssue(runtimeTokenMismatch, "runtime_token_limit_mismatch");
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
  const agentCallCountBefore = await prisma.agentCall.count();
  const effectiveResultCountBefore = await prisma.operationalAgentEffectiveResult.count();

  try {
    const approvedHash = activeOperationalConfigHash();

    if (suiteArg === "approval-manifest") {
      setEnv({
        ...approvedRuntimeEnvironmentAssertions,
        LLM_PROVIDER: "openai",
        LLM_LIVE_CALLS_ENABLED: "true",
        OPENAI_API_KEY: "fake-key-never-sent",
        OPERATIONAL_AGENT_MODE: "guarded_live",
        OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined,
        OPERATIONAL_APPROVED_CONFIG_HASH: approvedHash
      });
      assertApprovalManifestVerification();
      assert((await prisma.evalRun.count()) === evalRunCountBefore, "Approval manifest smoke must not mutate eval runs.");
      assert((await prisma.agentCall.count()) === agentCallCountBefore, "Approval manifest smoke must not create agent calls.");
      assert(
        (await prisma.operationalAgentEffectiveResult.count()) === effectiveResultCountBefore,
        "Approval manifest smoke must not create operational effective results."
      );
      console.log("Phase 8A approval-manifest smoke test passed. No OpenAI call was made.");
      return;
    }

    await cleanup();
    setEnv({
      ...approvedRuntimeEnvironmentAssertions,
      LLM_PROVIDER: "openai",
      LLM_LIVE_CALLS_ENABLED: "true",
      OPENAI_API_KEY: "fake-key-never-sent",
      OPERATIONAL_AGENT_MODE: "guarded_live",
      OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined,
      OPERATIONAL_APPROVED_CONFIG_HASH: approvedHash
    });
    assertApprovalManifestVerification();

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

    setEnv({
      LLM_PROVIDER: "openai",
      LLM_LIVE_CALLS_ENABLED: "true",
      OPENAI_API_KEY: "fake-key-never-sent",
      OPERATIONAL_AGENT_MODE: "guarded_live",
      OPERATIONAL_APPROVED_CONFIG_HASH: approvedHash,
      OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined
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
      OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined,
      OPERATIONAL_APPROVED_CONFIG_HASH: "wrong-hash"
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
