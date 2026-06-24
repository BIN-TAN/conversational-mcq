import { PrismaClient } from "@prisma/client";
import { createTargetedRemediationReadinessReport } from "../src/lib/services/evals/targeted-remediation-execution";
import { assert } from "./eval-live-canary-test-utils";
import {
  cleanupTargetedRemediationRecords,
  createMockTargetedRemediationRun
} from "./eval-targeted-remediation-test-utils";

const prisma = new PrismaClient();

async function main() {
  await cleanupTargetedRemediationRecords(prisma);
  const { summary } = await createMockTargetedRemediationRun(prisma, true);
  const ready = await createTargetedRemediationReadinessReport(summary.run_public_id);

  assert(ready.recommendation === "ready_for_guarded_integration_patch", "All-pass synthetic targeted run should pass readiness gates.");
  assert(ready.gates.planned_outputs_22, "Report should require 22 planned outputs.");
  assert(ready.gates.confirmed_annotations_22, "Report should require 22 confirmed annotations.");
  assert(ready.gates.affected_outputs_all_pass, "All affected outputs should be required to pass.");
  assert(ready.gates.controls_at_least_9_of_10_pass, "At least nine controls should pass.");
  assert(ready.gates.engineering_gates_passed, "Engineering gates should pass.");
  assert(ready.classroom_validity === false, "Report must not claim classroom validity.");

  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: summary.run_public_id },
    include: { run_items: { include: { eval_case: true, annotations: true }, orderBy: { run_order: "asc" } } }
  });
  const firstAnnotation = run.run_items[0].annotations[0];
  await prisma.evalAnnotation.update({
    where: { id: firstAnnotation.id },
    data: {
      pass_fail: "fail",
      safety_flags: ["unsupported_claim_of_certainty"]
    }
  });
  const criticalFailure = await createTargetedRemediationReadinessReport(summary.run_public_id);
  assert(criticalFailure.recommendation === "not_ready_for_guarded_integration_patch", "A confirmed critical failure should block targeted readiness.");

  await prisma.evalAnnotation.update({
    where: { id: firstAnnotation.id },
    data: {
      pass_fail: "pass",
      safety_flags: []
    }
  });
  const firstAffected = run.run_items.find((item) => item.evaluation_stratum === "affected")!;
  await prisma.evalAnnotation.update({
    where: { id: firstAffected.annotations[0].id },
    data: { pass_fail: "fail" }
  });
  const affectedFailure = await createTargetedRemediationReadinessReport(summary.run_public_id);
  assert(affectedFailure.recommendation === "not_ready_for_guarded_integration_patch", "Any affected failure should block targeted readiness.");

  await prisma.evalAnnotation.update({
    where: { id: firstAffected.annotations[0].id },
    data: { pass_fail: "pass" }
  });
  await prisma.evalAnnotation.delete({
    where: { id: firstAnnotation.id }
  });
  const incomplete = await createTargetedRemediationReadinessReport(summary.run_public_id);
  assert(incomplete.recommendation === "incomplete_review", "Missing annotation should make targeted report incomplete.");

  await cleanupTargetedRemediationRecords(prisma);
  console.log("Targeted remediation report smoke test passed. No OpenAI call was made.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupTargetedRemediationRecords(prisma).catch(() => undefined);
    await prisma.$disconnect();
  });
