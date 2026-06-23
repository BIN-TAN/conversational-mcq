import { PrismaClient } from "@prisma/client";
import { createFullPilotReadinessReport } from "../src/lib/services/evals/pilot-execution";
import { assert, cleanupLiveCanaryRecords } from "./eval-live-canary-test-utils";
import { createMockPilotRun } from "./eval-live-pilot-test-utils";

const prisma = new PrismaClient();

async function main() {
  await cleanupLiveCanaryRecords(prisma);
  const { pilotRunPublicId } = await createMockPilotRun(prisma);
  const ready = await createFullPilotReadinessReport(pilotRunPublicId);

  assert(ready.recommendation === "ready_for_controlled_operational_integration", "All-pass synthetic pilot should pass readiness gates.");
  assert(ready.primary_internal_holdout.confirmed_annotation_count === 50, "Internal holdout section should include 50 confirmed annotations.");
  assert(ready.replication.confirmed_annotation_count === 50, "Replication section should include 50 confirmed annotations.");
  assert(ready.known_failure_gate.passed === true, "Known-failure gate should pass for confirmed replication passes.");
  assert(ready.gates.planned_outputs_100, "Report should require 100 planned outputs.");
  assert(ready.gates.confirmed_annotations_100, "Report should require 100 confirmed annotations.");
  assert(ready.classroom_validity === false, "Report must not claim classroom validity.");

  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: pilotRunPublicId },
    include: { run_items: { include: { annotations: true } } }
  });
  const firstAnnotation = run.run_items[0].annotations[0];
  await prisma.evalAnnotation.update({
    where: { id: firstAnnotation.id },
    data: {
      pass_fail: "fail",
      safety_flags: ["unsupported_claim_of_certainty"]
    }
  });
  const failed = await createFullPilotReadinessReport(pilotRunPublicId);
  assert(failed.recommendation === "not_ready_for_controlled_operational_integration", "A confirmed critical failure should block readiness.");

  await prisma.evalAnnotation.update({
    where: { id: firstAnnotation.id },
    data: {
      pass_fail: "pass",
      safety_flags: []
    }
  });
  await prisma.evalAnnotation.delete({
    where: { id: firstAnnotation.id }
  });
  const incomplete = await createFullPilotReadinessReport(pilotRunPublicId);
  assert(incomplete.recommendation === "incomplete_review", "Missing annotation should make report incomplete.");

  await cleanupLiveCanaryRecords(prisma);
  console.log("Pilot report smoke test passed. No OpenAI call was made.");
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
