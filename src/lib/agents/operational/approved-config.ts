import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AgentName, type AgentName as AgentNameType } from "@/lib/agents/names";
import { listAgentPrompts } from "@/lib/agents/prompts/registry";
import type { AgentModelConfig } from "@/lib/llm/config";
import { getServerEnv } from "@/lib/env";

export const APPROVED_OPERATIONAL_CONFIG_PATH = path.join(
  process.cwd(),
  "config",
  "approved-operational-agent-config.json"
);

const agentConfigSchema = z.object({
  agent_version: z.string().min(1),
  prompt_version: z.string().min(1),
  prompt_hash: z.string().min(1),
  schema_version: z.string().min(1),
  max_output_tokens: z.number().int().positive()
}).strict();

const approvedConfigSchema = z.object({
  manifest_version: z.string().min(1),
  generated_from_git_commit: z.string().min(1),
  model_snapshot: z.literal("gpt-5.4-mini-2026-03-17"),
  reasoning_effort: z.literal("low"),
  agents: z.record(AgentName, agentConfigSchema),
  semantic_validator_version: z.literal("eval-semantic-v3"),
  safety_validator_version: z.literal("eval-safety-v3"),
  effective_result_version: z.literal("effective-system-eval-v2"),
  effective_validator_version: z.literal("effective-validator-v1"),
  deterministic_guard_versions: z.record(z.string(), z.string()),
  canonicalization_versions: z.record(z.string(), z.string()),
  fallback_versions: z.record(z.string(), z.string()),
  evaluation_evidence: z.object({
    canary_run_public_id: z.literal("evr_20260623_trzkizm"),
    full_pilot_run_public_id: z.literal("evr_20260623_ga6kzai"),
    targeted_run_public_id: z.literal("evr_20260624_bltzgtq"),
    review_target: z.literal("effective_system_output"),
    review_artifact_version: z.literal("effective-system-eval-v2"),
    targeted_ai_review: z.object({
      pass_count: z.literal(22),
      fail_count: z.literal(0),
      critical_failure_count: z.literal(0)
    }).strict(),
    recommendation: z.literal("ready_for_guarded_integration_patch"),
    classroom_validity: z.literal(false),
    human_review_pending: z.literal(true)
  }).strict(),
  approved_active_configuration_hash: z.string().min(1),
  config_hash: z.string().min(1)
}).strict();

export type ApprovedOperationalAgentConfig = z.infer<typeof approvedConfigSchema>;

export type ApprovedOperationalConfigVerification = {
  valid: boolean;
  manifest_hash: string;
  approved_hash: string;
  issues: Array<{ code: string; message: string; details?: unknown }>;
  active_configuration_hash: string;
  active_agents: Record<string, {
    agent_version: string;
    prompt_version: string;
    prompt_hash: string;
    schema_version: string;
    max_output_tokens: number;
  }>;
  runtime_model_resolution: Record<string, {
    approved_model_snapshot: string;
    resolved_model_snapshot: string | null;
    approved_reasoning_effort: string;
    resolved_reasoning_effort: string | null;
    approved_max_output_tokens: number;
    resolved_max_output_tokens: number | null;
    source: string;
  }>;
  manifest: ApprovedOperationalAgentConfig;
};

type ActiveAgentConfig = ApprovedOperationalConfigVerification["active_agents"][string];
type RuntimeModelResolution = {
  model_name?: string | null;
  reasoning_effort?: string | null;
  max_output_tokens?: number | null;
  source: string;
};

type ApprovedOperationalConfigVerificationOptions = {
  activeAgentConfigOverridesForTest?: Partial<Record<AgentNameType, Partial<ActiveAgentConfig>>>;
  runtimeModelConfigOverridesForTest?: Partial<Record<AgentNameType, Partial<RuntimeModelResolution>>>;
};

const agentMaxTokenEnvKeys: Record<AgentNameType, keyof ReturnType<typeof getServerEnv>> = {
  item_verification_agent: "OPENAI_MAX_OUTPUT_TOKENS_ITEM_VERIFICATION",
  response_collection_agent: "OPENAI_MAX_OUTPUT_TOKENS_RESPONSE_COLLECTION",
  student_profiling_agent: "OPENAI_MAX_OUTPUT_TOKENS_PROFILING",
  formative_value_and_planning_agent: "OPENAI_MAX_OUTPUT_TOKENS_PLANNING",
  followup_agent: "OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP"
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stable);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])])
    );
  }

  return value;
}

export function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function readApprovedOperationalAgentConfig() {
  return approvedConfigSchema.parse(
    JSON.parse(readFileSync(APPROVED_OPERATIONAL_CONFIG_PATH, "utf8"))
  );
}

export function approvedOperationalConfigHash(config: ApprovedOperationalAgentConfig) {
  const copy = { ...config, config_hash: undefined } as Record<string, unknown>;
  delete copy.config_hash;
  return stableHash(copy);
}

export function activeOperationalAgentConfigSnapshot() {
  const env = getServerEnv();
  const prompts = Object.fromEntries(listAgentPrompts().map((prompt) => [prompt.agent_name, prompt]));
  const approvedConfig = readApprovedOperationalAgentConfig();

  return {
    model_snapshot: "gpt-5.4-mini-2026-03-17",
    reasoning_effort: "low",
    agents: Object.fromEntries(
      AgentName.options.map((agentName) => {
        const prompt = prompts[agentName];
        const approvedAgent = approvedConfig.agents[agentName];

        if (!prompt || !approvedAgent) {
          throw new Error(`Operational agent registry is missing ${agentName}.`);
        }

        const configuredMaxTokens = env[agentMaxTokenEnvKeys[agentName]];
        return [
          agentName,
          {
            agent_version: prompt.agent_version,
            prompt_version: prompt.prompt_version,
            prompt_hash: prompt.prompt_hash,
            schema_version: prompt.schema_version,
            max_output_tokens:
              typeof configuredMaxTokens === "number"
                ? configuredMaxTokens
                : approvedAgent.max_output_tokens
          }
        ];
      })
    ),
    semantic_validator_version: "eval-semantic-v3",
    safety_validator_version: "eval-safety-v3",
    effective_result_version: env.OPERATIONAL_EFFECTIVE_RESULT_VERSION,
    effective_validator_version: env.OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION
  };
}

export function activeOperationalConfigHash() {
  return stableHash(activeOperationalAgentConfigSnapshot());
}

function resolvedOperationalRuntimeModelConfig(
  agentName: AgentNameType,
  override?: Partial<RuntimeModelResolution>
): RuntimeModelResolution {
  const approved = approvedModelConfigForAgent(agentName);
  return {
    model_name: approved.model_name,
    reasoning_effort: approved.reasoning_effort ?? null,
    max_output_tokens: approved.max_output_tokens ?? null,
    source: "approvedOperationalModelConfigForAgent",
    ...(override ?? {})
  };
}

function applyActiveAgentOverrides(
  activeAgents: ApprovedOperationalConfigVerification["active_agents"],
  overrides?: ApprovedOperationalConfigVerificationOptions["activeAgentConfigOverridesForTest"]
) {
  if (!overrides) {
    return activeAgents;
  }

  return Object.fromEntries(
    Object.entries(activeAgents).map(([agentName, config]) => [
      agentName,
      {
        ...config,
        ...(overrides[agentName as AgentNameType] ?? {})
      }
    ])
  ) as ApprovedOperationalConfigVerification["active_agents"];
}

export function verifyApprovedOperationalAgentConfig(
  options: ApprovedOperationalConfigVerificationOptions = {}
): ApprovedOperationalConfigVerification {
  const env = getServerEnv();
  const manifest = readApprovedOperationalAgentConfig();
  const issues: ApprovedOperationalConfigVerification["issues"] = [];
  const manifestHash = approvedOperationalConfigHash(manifest);
  const activeSnapshot = activeOperationalAgentConfigSnapshot();
  activeSnapshot.agents = applyActiveAgentOverrides(
    activeSnapshot.agents,
    options.activeAgentConfigOverridesForTest
  );
  const activeHash = stableHash(activeSnapshot);
  const runtimeModelResolution = Object.fromEntries(
    AgentName.options.map((agentName) => {
      const approved = manifest.agents[agentName];
      const resolved = resolvedOperationalRuntimeModelConfig(
        agentName,
        options.runtimeModelConfigOverridesForTest?.[agentName]
      );
      return [
        agentName,
        {
          approved_model_snapshot: manifest.model_snapshot,
          resolved_model_snapshot: resolved.model_name ?? null,
          approved_reasoning_effort: manifest.reasoning_effort,
          resolved_reasoning_effort: resolved.reasoning_effort ?? null,
          approved_max_output_tokens: approved?.max_output_tokens ?? null,
          resolved_max_output_tokens: resolved.max_output_tokens ?? null,
          source: resolved.source
        }
      ];
    })
  ) as ApprovedOperationalConfigVerification["runtime_model_resolution"];

  if (manifestHash !== manifest.config_hash) {
    issues.push({
      code: "manifest_hash_mismatch",
      message: "Approved operational manifest hash does not match manifest contents."
    });
  }

  for (const agentName of AgentName.options) {
    const active = activeSnapshot.agents[agentName];
    const approved = manifest.agents[agentName];

    if (!approved) {
      issues.push({ code: "missing_approved_agent", message: `Manifest is missing ${agentName}.` });
      continue;
    }

    for (const key of ["agent_version", "prompt_version", "prompt_hash", "schema_version", "max_output_tokens"] as const) {
      if (active[key] !== approved[key]) {
        issues.push({
          code: "active_agent_config_mismatch",
          message: `${agentName} ${key} does not match approved operational manifest.`,
          details: { agent_name: agentName, field: key }
        });
      }
    }

    const resolved = runtimeModelResolution[agentName];

    if (!resolved.resolved_model_snapshot) {
      issues.push({
        code: "model_snapshot_missing",
        message: `${agentName} resolved runtime model snapshot is missing.`,
        details: { agent_name: agentName, source: resolved.source }
      });
    } else if (resolved.resolved_model_snapshot !== resolved.approved_model_snapshot) {
      issues.push({
        code: "model_snapshot_mismatch",
        message: `${agentName} resolved runtime model is not the approved exact snapshot.`,
        details: {
          agent_name: agentName,
          source: resolved.source,
          approved_model_snapshot: resolved.approved_model_snapshot,
          resolved_model_snapshot: resolved.resolved_model_snapshot
        }
      });
    }

    if (!resolved.resolved_reasoning_effort) {
      issues.push({
        code: "reasoning_effort_missing",
        message: `${agentName} resolved runtime reasoning effort is missing.`,
        details: { agent_name: agentName, source: resolved.source }
      });
    } else if (resolved.resolved_reasoning_effort !== resolved.approved_reasoning_effort) {
      issues.push({
        code: "reasoning_effort_mismatch",
        message: `${agentName} resolved runtime reasoning effort is not the approved value.`,
        details: {
          agent_name: agentName,
          source: resolved.source,
          approved_reasoning_effort: resolved.approved_reasoning_effort,
          resolved_reasoning_effort: resolved.resolved_reasoning_effort
        }
      });
    }

    if (resolved.resolved_max_output_tokens !== resolved.approved_max_output_tokens) {
      issues.push({
        code: "runtime_token_limit_mismatch",
        message: `${agentName} resolved runtime token limit does not match the approved manifest.`,
        details: {
          agent_name: agentName,
          source: resolved.source,
          approved_max_output_tokens: resolved.approved_max_output_tokens,
          resolved_max_output_tokens: resolved.resolved_max_output_tokens
        }
      });
    }
  }

  if (activeSnapshot.effective_result_version !== manifest.effective_result_version) {
    issues.push({
      code: "effective_result_version_mismatch",
      message: "OPERATIONAL_EFFECTIVE_RESULT_VERSION does not match the approved manifest."
    });
  }

  if (activeSnapshot.effective_validator_version !== manifest.effective_validator_version) {
    issues.push({
      code: "effective_validator_version_mismatch",
      message: "OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION does not match the approved manifest."
    });
  }

  if (env.OPERATIONAL_APPROVED_CONFIG_HASH && env.OPERATIONAL_APPROVED_CONFIG_HASH !== activeHash) {
    issues.push({
      code: "approved_config_hash_env_mismatch",
      message: "OPERATIONAL_APPROVED_CONFIG_HASH does not match the active operational configuration hash."
    });
  }

  if (manifest.approved_active_configuration_hash !== activeHash) {
    issues.push({
      code: "active_configuration_hash_mismatch",
      message: "Active operational configuration hash does not match the approved manifest hash."
    });
  }

  return {
    valid: issues.length === 0,
    manifest_hash: manifestHash,
    approved_hash: manifest.config_hash,
    issues,
    active_configuration_hash: activeHash,
    active_agents: activeSnapshot.agents,
    runtime_model_resolution: runtimeModelResolution,
    manifest
  };
}

export function approvedModelConfigForAgent(agentName: AgentNameType): AgentModelConfig {
  const manifest = readApprovedOperationalAgentConfig();
  const agent = manifest.agents[agentName];

  if (!agent) {
    throw new Error(`Approved operational manifest is missing ${agentName}.`);
  }

  return {
    model_name: manifest.model_snapshot,
    reasoning_effort: manifest.reasoning_effort,
    max_output_tokens: agent.max_output_tokens
  };
}
