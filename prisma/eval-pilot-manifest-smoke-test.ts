import { PrismaClient } from "@prisma/client";
import { loadLiveCanaryManifest } from "../src/lib/services/evals/canary-manifest";
import {
  EVAL_PILOT_AGENT_ORDER,
  EVAL_PILOT_BASE_CASES_TOTAL,
  EVAL_PILOT_CASES_PER_STRATUM_PER_AGENT,
  EVAL_PILOT_REPETITIONS,
  EVAL_PILOT_TOTAL_ITEMS,
  loadLivePilotManifest
} from "../src/lib/services/evals/pilot-manifest";
import { seedEvalFixtures } from "../src/lib/services/evals/service";
import { ensureTeacherReviewDemoUsers } from "./demo-teacher-review-fixture";
import { assert } from "./eval-live-canary-test-utils";

const prisma = new PrismaClient();

async function main() {
  const teacher = await ensureTeacherReviewDemoUsers(prisma);
  await seedEvalFixtures(teacher.teacher.id);

  const pilot = await loadLivePilotManifest();
  const canary = await loadLiveCanaryManifest();

  assert(pilot.valid, `Pilot manifest should validate: ${JSON.stringify(pilot.issues)}`);
  assert(pilot.ordered_base_cases.length === EVAL_PILOT_BASE_CASES_TOTAL, "Pilot should contain 50 unique base cases.");
  assert(pilot.planned_run_item_count === EVAL_PILOT_TOTAL_ITEMS, "Pilot should plan 100 run items.");
  assert(EVAL_PILOT_REPETITIONS === 2, "Pilot should use two repetitions.");

  for (const agentName of EVAL_PILOT_AGENT_ORDER) {
    const internal = pilot.manifest.strata.internal_holdout[agentName] ?? [];
    const replication = pilot.manifest.strata.replication[agentName] ?? [];
    const canaryCases = canary.manifest.agents[agentName] ?? [];

    assert(internal.length === EVAL_PILOT_CASES_PER_STRATUM_PER_AGENT, `${agentName} should have five holdout cases.`);
    assert(replication.length === EVAL_PILOT_CASES_PER_STRATUM_PER_AGENT, `${agentName} should have five replication cases.`);
    assert(JSON.stringify(replication) === JSON.stringify(canaryCases), `${agentName} replication cases should match canary cases.`);
    assert(new Set([...internal, ...replication]).size === 10, `${agentName} should have 10 non-overlapping base cases.`);
  }

  const dbCases = await prisma.evalCase.count({
    where: {
      case_id: { in: pilot.ordered_base_cases.map((entry) => entry.case_id) },
      case_source: "synthetic",
      status: "active"
    }
  });
  assert(dbCases === EVAL_PILOT_BASE_CASES_TOTAL, "All pilot cases should exist as active synthetic eval cases.");

  console.log("Pilot manifest smoke test passed. No OpenAI call was made.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
