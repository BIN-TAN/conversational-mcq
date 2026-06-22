import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentName as AgentNameType } from "@/lib/agents/names";
import { AgentName } from "@/lib/agents/names";
import {
  EVAL_CANARY_AGENT_ORDER,
  EVAL_CANARY_CASES_PER_AGENT,
  EVAL_CANARY_MODEL_SNAPSHOT,
  EVAL_CANARY_REASONING_EFFORT,
  EVAL_CANARY_REPETITIONS,
  EVAL_CANARY_TOTAL_ITEMS,
  sha256Json
} from "./canary-config";

const manifestSchema = z.object({
  manifest_version: z.string().min(1),
  model_snapshot: z.literal(EVAL_CANARY_MODEL_SNAPSHOT),
  reasoning_effort: z.literal(EVAL_CANARY_REASONING_EFFORT),
  repetition_count: z.literal(EVAL_CANARY_REPETITIONS),
  cases_per_agent: z.literal(EVAL_CANARY_CASES_PER_AGENT),
  agents: z.record(AgentName, z.array(z.string().min(1))),
  coverage_notes: z.record(z.string()).optional()
}).strict();

export type LiveCanaryManifest = z.infer<typeof manifestSchema>;

export async function loadLiveCanaryManifest() {
  const manifestPath = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "evals",
    "live-canary-manifest.json"
  );
  const raw = await readFile(manifestPath, "utf8");
  const manifest = manifestSchema.parse(JSON.parse(raw));
  const issues: Array<{ code: string; message: string }> = [];
  const seen = new Set<string>();
  const orderedCases: Array<{
    agent_name: AgentNameType;
    case_id: string;
    manifest_order: number;
  }> = [];
  let order = 1;

  for (const agentName of EVAL_CANARY_AGENT_ORDER) {
    const caseIds = manifest.agents[agentName] ?? [];

    if (caseIds.length !== EVAL_CANARY_CASES_PER_AGENT) {
      issues.push({
        code: "invalid_cases_per_agent",
        message: `${agentName} must have exactly ${EVAL_CANARY_CASES_PER_AGENT} canary cases.`
      });
    }

    for (const caseId of caseIds) {
      const uniqueKey = `${agentName}:${caseId}`;

      if (seen.has(uniqueKey)) {
        issues.push({
          code: "duplicate_case_id",
          message: `${uniqueKey} appears more than once in the live canary manifest.`
        });
      }

      seen.add(uniqueKey);
      orderedCases.push({ agent_name: agentName, case_id: caseId, manifest_order: order });
      order += 1;
    }
  }

  if (orderedCases.length !== EVAL_CANARY_TOTAL_ITEMS) {
    issues.push({
      code: "invalid_total_case_count",
      message: `The Phase 7E2A canary manifest must contain exactly ${EVAL_CANARY_TOTAL_ITEMS} cases.`
    });
  }

  return {
    manifest,
    manifest_path: manifestPath,
    manifest_hash: sha256Json(manifest),
    ordered_cases: orderedCases,
    valid: issues.length === 0,
    issues
  };
}
