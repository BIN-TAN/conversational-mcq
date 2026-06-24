import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  CONFIRMED_ANNOTATION_AMENDMENT_NOTE,
  amendConfirmedEvalAnnotations
} from "../src/lib/services/evals/confirmed-annotation-amendment";
import { generatePublicId } from "../src/lib/services/ids";
import { cleanupLiveCanaryRecords, operationalCounts } from "./eval-live-canary-test-utils";
import { createMockPilotRun } from "./eval-live-pilot-test-utils";

const prisma = new PrismaClient();
const targetCaseId = "fpa_mapping_followed_006";
const targetFlag = "incorrect_top_level_formative_value";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function hash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

async function targetEntries(runPublicId: string) {
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: runPublicId },
    include: {
      run_items: {
        include: {
          eval_case: true,
          annotations: true
        },
        orderBy: [{ run_order: "asc" }]
      }
    }
  });

  return run.run_items
    .filter((item) => item.eval_case.case_id === targetCaseId && [1, 2].includes(item.repetition_index))
    .map((item) => {
      const annotation = item.annotations.find((entry) => entry.annotation_status === "confirmed");

      assert(annotation, "Target item missing confirmed annotation.");

      return { run, item, annotation };
    });
}

async function prepareTargetRun(runPublicId: string) {
  const entries = await targetEntries(runPublicId);

  assert(entries.length === 2, "Synthetic pilot should have exactly two target repetitions.");

  for (const { item, annotation } of entries) {
    await prisma.evalRunItem.update({
      where: { id: item.id },
      data: {
        parsed_output: {
          formative_value: "confidence_calibration",
          mapping_followed: true,
          mapping_deviation_reason: "",
          output_status: "ok"
        }
      }
    });
    await prisma.evalAnnotation.update({
      where: { id: annotation.id },
      data: {
        pass_fail: "fail",
        overall_rating: 1,
        safety_flags: [targetFlag],
        notes: "Pre-amendment smoke-test critical flag."
      }
    });
  }
}

async function allAnnotationSnapshots(runPublicId: string) {
  const annotations = await prisma.evalAnnotation.findMany({
    where: { run_item: { run: { run_public_id: runPublicId } } },
    include: { run_item: { include: { eval_case: true } } },
    orderBy: { annotation_public_id: "asc" }
  });

  return new Map(
    annotations.map((annotation) => [
      annotation.annotation_public_id,
      {
        annotation_public_id: annotation.annotation_public_id,
        run_item_public_id: annotation.run_item.run_item_public_id,
        case_id: annotation.run_item.eval_case.case_id,
        repetition_index: annotation.run_item.repetition_index,
        annotation_source: annotation.annotation_source,
        annotation_status: annotation.annotation_status,
        confirmed_by_user_db_id: annotation.confirmed_by_user_db_id,
        confirmed_at: annotation.confirmed_at?.toISOString() ?? null,
        pass_fail: annotation.pass_fail,
        overall_rating: annotation.overall_rating,
        rubric_scores: annotation.rubric_scores,
        safety_flags: annotation.safety_flags,
        notes: annotation.notes
      }
    ])
  );
}

async function expectReject(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }

  throw new Error(`${label} should have rejected.`);
}

async function testMoreThanTwoAbort() {
  const { pilotRunPublicId } = await createMockPilotRun(prisma);
  await prepareTargetRun(pilotRunPublicId);
  const entries = await targetEntries(pilotRunPublicId);
  const unrelated = await prisma.evalAnnotation.findFirstOrThrow({
    where: {
      run_item: {
        run: { run_public_id: pilotRunPublicId },
        eval_case: { case_id: { not: targetCaseId } }
      },
      annotation_status: "confirmed"
    }
  });
  const extraUserId = `amendment_extra_${Date.now()}`;
  const extraUser = await prisma.user.create({
    data: {
      user_id: extraUserId,
      user_id_normalized: extraUserId.toLowerCase(),
      display_name: "Amendment Smoke Extra Teacher",
      role: "teacher_researcher"
    }
  });

  try {
    await prisma.evalAnnotation.create({
      data: {
        annotation_public_id: generatePublicId("eval_annotation"),
        run_item_db_id: entries[0].item.id,
        annotated_by_user_db_id: extraUser.id,
        confirmed_by_user_db_id: extraUser.id,
        blind_review: true,
        annotation_source: "human_manual",
        annotation_status: "confirmed",
        overall_rating: 1,
        pass_fail: "fail",
        rubric_scores: entries[0].annotation.rubric_scores ?? {},
        safety_flags: [targetFlag],
        notes: "Temporary duplicate target for smoke test.",
        confirmed_at: new Date()
      }
    });
    await prisma.evalAnnotation.delete({ where: { id: unrelated.id } });

    await expectReject("More than two target matches", () =>
      amendConfirmedEvalAnnotations({
        runPublicId: pilotRunPublicId,
        caseId: targetCaseId,
        removeCriticalFlag: targetFlag,
        confirmResearcherInstruction: true
      })
    );
  } finally {
    await cleanupLiveCanaryRecords(prisma);
    await prisma.user.delete({ where: { id: extraUser.id } }).catch(() => undefined);
  }
}

async function main() {
  await cleanupLiveCanaryRecords(prisma);
  const operationalBefore = await operationalCounts(prisma);

  await testMoreThanTwoAbort();

  const { pilotRunPublicId } = await createMockPilotRun(prisma);
  await prepareTargetRun(pilotRunPublicId);
  const beforeSnapshots = await allAnnotationSnapshots(pilotRunPublicId);
  const beforeTargets = [...beforeSnapshots.values()].filter((entry) => entry.case_id === targetCaseId);
  const beforeRunItems = await prisma.evalRunItem.findMany({
    where: { run: { run_public_id: pilotRunPublicId } },
    select: {
      run_item_public_id: true,
      semantic_validation_result: true,
      safety_validation_result: true
    }
  });
  const beforeValidationHash = hash(beforeRunItems);
  const revisionCountBefore = await prisma.evalAnnotationRevision.count();

  await expectReject("Missing confirmation flag", () =>
    amendConfirmedEvalAnnotations({
      runPublicId: pilotRunPublicId,
      caseId: targetCaseId,
      removeCriticalFlag: targetFlag,
      confirmResearcherInstruction: false
    })
  );
  await expectReject("Zero target matches", () =>
    amendConfirmedEvalAnnotations({
      runPublicId: pilotRunPublicId,
      caseId: "no_such_case",
      removeCriticalFlag: targetFlag,
      confirmResearcherInstruction: true
    })
  );

  const result = await amendConfirmedEvalAnnotations({
    runPublicId: pilotRunPublicId,
    caseId: targetCaseId,
    removeCriticalFlag: targetFlag,
    confirmResearcherInstruction: true
  });

  assert(result.target_match_count === 2, "Exactly two target annotations should be found.");
  assert(result.amended_count === 2, "Exactly two annotations should be amended.");
  assert(result.openai_call_made === false, "Amendment should not call OpenAI.");
  assert(result.operational_records_mutated === false, "Amendment service should not mutate operational records.");

  const afterSnapshots = await allAnnotationSnapshots(pilotRunPublicId);
  const afterTargets = [...afterSnapshots.values()].filter((entry) => entry.case_id === targetCaseId);

  for (const after of afterTargets) {
    const before = beforeTargets.find((entry) => entry.annotation_public_id === after.annotation_public_id);

    assert(before, "Target annotation missing from before snapshot.");
    assert(after.pass_fail === before.pass_fail, "Pass/fail should remain unchanged.");
    assert(after.pass_fail === "fail", "Target annotation should remain Fail.");
    assert(after.overall_rating === before.overall_rating, "Overall rating should remain unchanged.");
    assert(after.overall_rating === 1, "Target rating should remain 1.");
    assert(hash(after.rubric_scores) === hash(before.rubric_scores), "Rubric scores should remain unchanged.");
    assert(Array.isArray(after.safety_flags), "Safety flags should remain an array.");
    assert(!(after.safety_flags as string[]).includes(targetFlag), "Requested human critical flag should be removed.");
    assert(after.notes === CONFIRMED_ANNOTATION_AMENDMENT_NOTE, "Notes should be replaced exactly.");
    assert(after.annotation_source === before.annotation_source, "Annotation source should be preserved.");
    assert(after.annotation_status === "confirmed", "Annotation should remain confirmed.");
    assert(after.confirmed_by_user_db_id === before.confirmed_by_user_db_id, "Confirmer should be preserved.");
    assert(after.confirmed_at === before.confirmed_at, "Confirmation timestamp should be preserved.");
  }

  for (const [annotationPublicId, before] of beforeSnapshots.entries()) {
    if (before.case_id === targetCaseId) {
      continue;
    }

    const after = afterSnapshots.get(annotationPublicId);

    assert(after, "Other annotation disappeared.");
    assert(hash(after) === hash(before), "Non-target annotation changed.");
  }

  const afterRunItems = await prisma.evalRunItem.findMany({
    where: { run: { run_public_id: pilotRunPublicId } },
    select: {
      run_item_public_id: true,
      semantic_validation_result: true,
      safety_validation_result: true
    }
  });

  assert(hash(afterRunItems) === beforeValidationHash, "Automated findings should remain unchanged.");

  const revisionCountAfter = await prisma.evalAnnotationRevision.count();
  assert(revisionCountAfter === revisionCountBefore + 2, "Two revision audit records should be created.");

  const secondResult = await amendConfirmedEvalAnnotations({
    runPublicId: pilotRunPublicId,
    caseId: targetCaseId,
    removeCriticalFlag: targetFlag,
    confirmResearcherInstruction: true
  });
  const revisionCountAfterRepeat = await prisma.evalAnnotationRevision.count();

  assert(secondResult.amended_count === 0, "Repeated execution should be idempotent.");
  assert(secondResult.already_amended_count === 2, "Repeated execution should report already-amended targets.");
  assert(revisionCountAfterRepeat === revisionCountAfter, "Repeated execution should not create duplicate revisions.");

  await cleanupLiveCanaryRecords(prisma);
  const operationalAfter = await operationalCounts(prisma);

  assert(hash(operationalAfter) === hash(operationalBefore), "Operational records should not change.");
  console.log("Confirmed annotation amendment smoke test passed. No OpenAI call was made.");
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
