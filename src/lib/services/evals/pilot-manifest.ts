import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentName as AgentNameType } from "@/lib/agents/names";
import { AgentName } from "@/lib/agents/names";
import {
  EVAL_CANARY_AGENT_ORDER,
  EVAL_CANARY_MODEL_SNAPSHOT,
  EVAL_CANARY_REASONING_EFFORT,
  sha256Json
} from "./canary-config";
import { loadLiveCanaryManifest } from "./canary-manifest";

export const EVAL_PILOT_PHASE = "full_pilot";
export const EVAL_PILOT_REPETITIONS = 2;
export const EVAL_PILOT_CASES_PER_STRATUM_PER_AGENT = 5;
export const EVAL_PILOT_BASE_CASES_PER_AGENT = 10;
export const EVAL_PILOT_BASE_CASES_TOTAL = 50;
export const EVAL_PILOT_TOTAL_ITEMS = 100;
export const EVAL_PILOT_ORDERING_ALGORITHM_VERSION = "phase7e2b-balanced-v1";
export const EVAL_PILOT_AGENT_ORDER = EVAL_CANARY_AGENT_ORDER;
export const EVAL_PILOT_MODEL_SNAPSHOT = EVAL_CANARY_MODEL_SNAPSHOT;
export const EVAL_PILOT_REASONING_EFFORT = EVAL_CANARY_REASONING_EFFORT;

export const EvalPilotStratum = z.enum(["internal_holdout", "replication"]);
export type EvalPilotStratum = z.infer<typeof EvalPilotStratum>;

const pilotManifestSchema = z.object({
  manifest_version: z.string().min(1),
  approved_canary_manifest_version: z.string().min(1),
  model_snapshot: z.literal(EVAL_PILOT_MODEL_SNAPSHOT),
  reasoning_effort: z.literal(EVAL_PILOT_REASONING_EFFORT),
  repetition_count: z.literal(EVAL_PILOT_REPETITIONS),
  internal_holdout_cases_per_agent: z.literal(EVAL_PILOT_CASES_PER_STRATUM_PER_AGENT),
  replication_cases_per_agent: z.literal(EVAL_PILOT_CASES_PER_STRATUM_PER_AGENT),
  strata: z.object({
    internal_holdout: z.record(AgentName, z.array(z.string().min(1))),
    replication: z.record(AgentName, z.array(z.string().min(1)))
  }).strict()
}).strict();

export type LivePilotManifest = z.infer<typeof pilotManifestSchema>;

export type LivePilotManifestCase = {
  agent_name: AgentNameType;
  case_id: string;
  stratum: EvalPilotStratum;
  manifest_order: number;
};

export async function loadLivePilotManifest() {
  const manifestPath = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "evals",
    "live-pilot-manifest.json"
  );
  const raw = await readFile(manifestPath, "utf8");
  const manifest = pilotManifestSchema.parse(JSON.parse(raw));
  const canaryManifest = await loadLiveCanaryManifest();
  const issues: Array<{ code: string; message: string }> = [];
  const baseSeen = new Set<string>();
  const orderedBaseCases: LivePilotManifestCase[] = [];
  let order = 1;

  if (manifest.approved_canary_manifest_version !== canaryManifest.manifest.manifest_version) {
    issues.push({
      code: "approved_canary_manifest_version_mismatch",
      message: "Pilot manifest does not reference the current canary manifest version."
    });
  }

  for (const agentName of EVAL_PILOT_AGENT_ORDER) {
    const internalCases = manifest.strata.internal_holdout[agentName] ?? [];
    const replicationCases = manifest.strata.replication[agentName] ?? [];
    const canaryCases = canaryManifest.manifest.agents[agentName] ?? [];

    if (internalCases.length !== EVAL_PILOT_CASES_PER_STRATUM_PER_AGENT) {
      issues.push({
        code: "invalid_internal_holdout_count",
        message: `${agentName} must have exactly ${EVAL_PILOT_CASES_PER_STRATUM_PER_AGENT} internal_holdout cases.`
      });
    }

    if (replicationCases.length !== EVAL_PILOT_CASES_PER_STRATUM_PER_AGENT) {
      issues.push({
        code: "invalid_replication_count",
        message: `${agentName} must have exactly ${EVAL_PILOT_CASES_PER_STRATUM_PER_AGENT} replication cases.`
      });
    }

    if (JSON.stringify(replicationCases) !== JSON.stringify(canaryCases)) {
      issues.push({
        code: "replication_cases_do_not_match_canary",
        message: `${agentName} replication cases must exactly match the live canary manifest order.`
      });
    }

    const internalSet = new Set(internalCases);
    const replicationSet = new Set(replicationCases);
    const overlap = [...internalSet].filter((caseId) => replicationSet.has(caseId));

    if (internalSet.size !== internalCases.length || replicationSet.size !== replicationCases.length) {
      issues.push({
        code: "duplicate_case_within_agent_stratum",
        message: `${agentName} contains duplicate case IDs within a pilot stratum.`
      });
    }

    if (overlap.length) {
      issues.push({
        code: "stratum_overlap",
        message: `${agentName} has overlapping internal_holdout and replication cases: ${overlap.join(", ")}.`
      });
    }

    for (const stratum of EvalPilotStratum.options) {
      const caseIds = manifest.strata[stratum][agentName] ?? [];

      for (const caseId of caseIds) {
        const uniqueKey = `${agentName}:${caseId}`;

        if (baseSeen.has(uniqueKey)) {
          issues.push({
            code: "duplicate_base_case",
            message: `${uniqueKey} appears more than once in the full pilot manifest.`
          });
        }

        baseSeen.add(uniqueKey);
        orderedBaseCases.push({ agent_name: agentName, case_id: caseId, stratum, manifest_order: order });
        order += 1;
      }
    }

    if (new Set([...internalCases, ...replicationCases]).size !== EVAL_PILOT_BASE_CASES_PER_AGENT) {
      issues.push({
        code: "invalid_base_cases_per_agent",
        message: `${agentName} must have ${EVAL_PILOT_BASE_CASES_PER_AGENT} unique pilot base cases.`
      });
    }
  }

  if (orderedBaseCases.length !== EVAL_PILOT_BASE_CASES_TOTAL || baseSeen.size !== EVAL_PILOT_BASE_CASES_TOTAL) {
    issues.push({
      code: "invalid_total_base_case_count",
      message: `The Phase 7E2B pilot manifest must contain exactly ${EVAL_PILOT_BASE_CASES_TOTAL} unique base cases.`
    });
  }

  return {
    manifest,
    manifest_path: manifestPath,
    manifest_hash: sha256Json(manifest),
    ordered_base_cases: orderedBaseCases,
    planned_run_item_count: orderedBaseCases.length * EVAL_PILOT_REPETITIONS,
    valid: issues.length === 0,
    issues,
    canary_manifest_hash: canaryManifest.manifest_hash
  };
}
