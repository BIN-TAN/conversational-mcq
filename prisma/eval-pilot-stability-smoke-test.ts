import { PrismaClient } from "@prisma/client";
import {
  calculatePilotStabilityMetrics,
  createFullPilotReadinessReport
} from "../src/lib/services/evals/pilot-execution";
import { assert, cleanupLiveCanaryRecords } from "./eval-live-canary-test-utils";
import { createMockPilotRun } from "./eval-live-pilot-test-utils";

const prisma = new PrismaClient();

async function main() {
  await cleanupLiveCanaryRecords(prisma);
  const { pilotRunPublicId } = await createMockPilotRun(prisma);
  const stability = await calculatePilotStabilityMetrics(pilotRunPublicId);

  assert(stability.pair_count === 50, "Pilot stability should compare 50 paired outputs.");
  assert(stability.paired_human_pass_fail_agreement === 1, "All-pass synthetic annotations should have perfect pass/fail agreement.");
  assert(stability.paired_output_with_confirmed_critical_failure_count === 0, "No paired output should have confirmed critical failures.");
  for (const value of Object.values(stability.core_categorical_agreement_by_agent)) {
    assert((value ?? 0) >= 0.8, "Core categorical agreement should meet the smoke-test threshold.");
  }

  const report = await createFullPilotReadinessReport(pilotRunPublicId);
  assert(report.stability.pair_count === 50, "Readiness report should include stability metrics.");
  assert(report.classroom_validity === false, "Report must not claim classroom validity.");

  await cleanupLiveCanaryRecords(prisma);
  console.log("Pilot stability smoke test passed. No OpenAI call was made.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupLiveCanaryRecords(prisma).catch(() => undefined);
    await prisma.$disconnect();
  });
