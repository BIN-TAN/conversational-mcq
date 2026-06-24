import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentName as AgentNameType } from "@/lib/agents/names";
import { AgentName } from "@/lib/agents/names";
import {
  EVAL_CANARY_MODEL_SNAPSHOT,
  EVAL_CANARY_REASONING_EFFORT,
  sha256Json
} from "./canary-config";

export const EVAL_TARGETED_REMEDIATION_PHASE = "targeted_remediation";
export const EVAL_TARGETED_REMEDIATION_BASELINE_RUN_PUBLIC_ID = "evr_20260623_ga6kzai";
export const EVAL_TARGETED_REMEDIATION_REPETITIONS = 2;
export const EVAL_TARGETED_REMEDIATION_AFFECTED_CASE_COUNT = 6;
export const EVAL_TARGETED_REMEDIATION_CONTROL_CASE_COUNT = 5;
export const EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS =
  (EVAL_TARGETED_REMEDIATION_AFFECTED_CASE_COUNT +
    EVAL_TARGETED_REMEDIATION_CONTROL_CASE_COUNT) *
  EVAL_TARGETED_REMEDIATION_REPETITIONS;
export const EVAL_TARGETED_REMEDIATION_ORDERING_ALGORITHM_VERSION =
  "phase7e2c-targeted-remediation-v1";
export const EVAL_TARGETED_REMEDIATION_AGENT_ORDER = AgentName.options;
export const EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT = EVAL_CANARY_MODEL_SNAPSHOT;
export const EVAL_TARGETED_REMEDIATION_REASONING_EFFORT = EVAL_CANARY_REASONING_EFFORT;

const manifestEntrySchema = z.object({
  agent_name: AgentName,
  case_id: z.string().min(1),
  remediation_focus: z.string().min(1)
}).strict();

const manifestSchema = z.object({
  manifest_version: z.string().min(1),
  baseline_run_public_id: z.literal(EVAL_TARGETED_REMEDIATION_BASELINE_RUN_PUBLIC_ID),
  model_snapshot: z.literal(EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT),
  reasoning_effort: z.literal(EVAL_TARGETED_REMEDIATION_REASONING_EFFORT),
  repetition_count: z.literal(EVAL_TARGETED_REMEDIATION_REPETITIONS),
  affected_cases: z.array(manifestEntrySchema),
  control_cases: z.array(manifestEntrySchema)
}).strict();

export type TargetedRemediationManifest = z.infer<typeof manifestSchema>;

export type TargetedRemediationManifestCase = {
  agent_name: AgentNameType;
  case_id: string;
  remediation_focus: string;
  stratum: "affected" | "control";
  manifest_order: number;
};

export async function loadTargetedRemediationManifest() {
  const manifestPath = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "evals",
    "targeted-remediation-manifest.json"
  );
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const issues: Array<{ code: string; message: string }> = [];
  const cases: TargetedRemediationManifestCase[] = [];
  const seen = new Set<string>();
  let order = 1;

  if (manifest.affected_cases.length !== EVAL_TARGETED_REMEDIATION_AFFECTED_CASE_COUNT) {
    issues.push({
      code: "invalid_affected_case_count",
      message: `Targeted remediation manifest must contain ${EVAL_TARGETED_REMEDIATION_AFFECTED_CASE_COUNT} affected cases.`
    });
  }

  if (manifest.control_cases.length !== EVAL_TARGETED_REMEDIATION_CONTROL_CASE_COUNT) {
    issues.push({
      code: "invalid_control_case_count",
      message: `Targeted remediation manifest must contain ${EVAL_TARGETED_REMEDIATION_CONTROL_CASE_COUNT} control cases.`
    });
  }

  const controlAgents = new Set(manifest.control_cases.map((entry) => entry.agent_name));
  for (const agentName of AgentName.options) {
    if (!controlAgents.has(agentName)) {
      issues.push({
        code: "missing_control_agent",
        message: `Targeted remediation manifest is missing a control case for ${agentName}.`
      });
    }
  }

  for (const [stratum, entries] of [
    ["affected", manifest.affected_cases],
    ["control", manifest.control_cases]
  ] as const) {
    for (const entry of entries) {
      const key = `${entry.agent_name}:${entry.case_id}`;

      if (seen.has(key)) {
        issues.push({
          code: "duplicate_manifest_case",
          message: `${key} appears more than once in the targeted remediation manifest.`
        });
      }

      seen.add(key);
      cases.push({
        agent_name: entry.agent_name,
        case_id: entry.case_id,
        remediation_focus: entry.remediation_focus,
        stratum,
        manifest_order: order
      });
      order += 1;
    }
  }

  const plannedRunItemCount = cases.length * EVAL_TARGETED_REMEDIATION_REPETITIONS;
  if (plannedRunItemCount !== EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS) {
    issues.push({
      code: "invalid_targeted_run_item_count",
      message: `Targeted remediation must plan exactly ${EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS} outputs.`
    });
  }

  return {
    manifest,
    manifest_path: manifestPath,
    manifest_hash: sha256Json(manifest),
    ordered_base_cases: cases,
    planned_run_item_count: plannedRunItemCount,
    valid: issues.length === 0,
    issues
  };
}
