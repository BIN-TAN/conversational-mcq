import { PrismaClient } from "@prisma/client";
import {
  confirmAllEvalAnnotationsForRun,
  confirmEvalAnnotation,
  importDraftAnnotationsForRun
} from "../src/lib/services/evals/annotation-adjudication";
import { createCanaryReadinessReport } from "../src/lib/services/evals/live-execution";
import { cleanupEvalFixtures, upsertEvalAnnotation } from "../src/lib/services/evals/service";
import type { PublicUser } from "../src/types/auth";
import {
  assert,
  buildCompletedAnnotationCsv,
  createMockCanaryRunForAnnotationSmoke
} from "./eval-annotation-smoke-utils";
import { cleanupLiveCanaryRecords, operationalCounts } from "./eval-live-canary-test-utils";

const prisma = new PrismaClient();
const attestation =
  "I reviewed the imported annotation decisions and accept them as my confirmed evaluation judgments.";

async function main() {
  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  const runPublicId = await createMockCanaryRunForAnnotationSmoke(prisma);
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: runPublicId },
    include: {
      created_by: { select: { id: true, user_id: true } },
      run_items: { include: { eval_case: true }, orderBy: [{ run_order: "asc" }] }
    }
  });
  const teacherUser: PublicUser = {
    user_db_id: run.created_by.id,
    user_id: run.created_by.user_id,
    role: "teacher_researcher",
    auth_version: 1
  };
  const fixture = await buildCompletedAnnotationCsv({ runPublicId });
  const before = await operationalCounts(prisma);

  const autoFlagCases = new Map([
    ["rca_hint_request_004", "hint_or_explanation_in_initial_administration"],
    ["fua_prompt_injection_redirect_008", "hidden_prompt_disclosure"],
    ["spa_conflicting_evidence_010", "unsupported_claim_of_certainty"]
  ]);

  for (const [caseId, flag] of autoFlagCases) {
    const item = run.run_items.find((entry) => entry.eval_case.case_id === caseId);
    assert(item, `Missing auto-flag case ${caseId}.`);
    await prisma.evalRunItem.update({
      where: { id: item.id },
      data: {
        safety_validation_result: {
          ok: false,
          issues: [`Synthetic automated screening flag for ${caseId}.`],
          warnings: [],
          critical_failure_flags: [flag]
        }
      }
    });
  }

  await importDraftAnnotationsForRun({
    runPublicId,
    data: {
      annotation_csv_text: fixture.annotation_csv_text,
      reference_jsonl_text: fixture.reference_text
    },
    requestedByUserDbId: run.created_by.id
  });

  const beforeConfirmation = await createCanaryReadinessReport(runPublicId);
  assert(beforeConfirmation.recommendation === "incomplete_review", "Draft-only annotations should leave review incomplete.");
  assert(beforeConfirmation.gates.human_annotations_25 === false, "Draft annotations should not count as human_annotations_25.");
  assert(beforeConfirmation.automated_critical_failure_count === 3, "Automated flags should remain stored.");
  assert(beforeConfirmation.human_confirmed_critical_failure_count === 0, "Draft human flags should not count as confirmed.");
  assert(beforeConfirmation.auto_human_disagreement_count === 3, "Auto-human disagreements should be visible before confirmation.");

  const firstDraft = await prisma.evalAnnotation.findFirstOrThrow({
    where: { run_item: { run_db_id: run.id }, annotation_status: "draft" },
    include: { run_item: true }
  });
  await upsertEvalAnnotation(
    firstDraft.run_item.run_item_public_id,
    {
      blind_review: true,
      overall_rating: firstDraft.overall_rating,
      pass_fail: firstDraft.pass_fail,
      rubric_scores: firstDraft.rubric_scores,
      safety_flags: firstDraft.safety_flags,
      notes: "Teacher edited this draft annotation before confirmation."
    },
    teacherUser
  );
  const editedDraft = await prisma.evalAnnotation.findUniqueOrThrow({
    where: { id: firstDraft.id }
  });
  assert(editedDraft.annotation_status === "draft", "Editing a draft should not auto-confirm it.");
  assert(editedDraft.notes === "Teacher edited this draft annotation before confirmation.", "Draft edit should persist.");

  await confirmEvalAnnotation(firstDraft.run_item.run_item_public_id, teacherUser);
  const oneConfirmed = await prisma.evalAnnotation.count({
    where: { run_item: { run_db_id: run.id }, annotation_status: "confirmed" }
  });
  assert(oneConfirmed === 1, "Single confirmation should confirm exactly one annotation.");

  await confirmAllEvalAnnotationsForRun(runPublicId, { attestation }, teacherUser);
  const afterConfirmation = await createCanaryReadinessReport(runPublicId);
  const after = await operationalCounts(prisma);

  assert(afterConfirmation.gates.human_annotations_25 === true, "All annotations should be confirmed.");
  assert(afterConfirmation.annotation_completion_count === 25, "Report should count 25 confirmed annotations.");
  assert(afterConfirmation.human_confirmed_critical_failure_count === 0, "Supplied annotations have no human critical flags.");
  assert(afterConfirmation.annotation_pass_rate_by_agent.item_verification_agent.pass_rate === 0.8, "IVA pass rate should be 80%.");
  assert(afterConfirmation.annotation_pass_rate_by_agent.response_collection_agent.pass_rate === 1, "RCA pass rate should be 100%.");
  assert(afterConfirmation.annotation_pass_rate_by_agent.student_profiling_agent.pass_rate === 0.8, "SPA pass rate should be 80%.");
  assert(afterConfirmation.annotation_pass_rate_by_agent.formative_value_and_planning_agent.pass_rate === 1, "Planning pass rate should be 100%.");
  assert(afterConfirmation.annotation_pass_rate_by_agent.followup_agent.pass_rate === 0.8, "Follow-up pass rate should be 80%.");
  assert(afterConfirmation.automated_critical_failure_count === 3, "Report should retain automated screening metrics.");
  assert(afterConfirmation.human_critical_failure_case_ids.length === 0, "Automated false positives must not count as confirmed human critical failures.");
  assert(afterConfirmation.recommendation === "ready_for_full_pilot", "Human-adjudicated false positives should not block readiness.");
  assert(after.agentCalls === before.agentCalls, "Adjudication created operational agent calls.");
  assert(after.studentProfiles === before.studentProfiles, "Adjudication created operational profiles.");
  assert(after.formativeDecisions === before.formativeDecisions, "Adjudication created operational decisions.");
  assert(after.followupRounds === before.followupRounds, "Adjudication created operational follow-up rounds.");
  assert(after.workflowJobs === before.workflowJobs, "Adjudication created workflow jobs.");

  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  console.log("Annotation adjudication smoke test passed. No OpenAI call was made.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupLiveCanaryRecords(prisma).catch(() => undefined);
    await cleanupEvalFixtures().catch(() => undefined);
    await prisma.$disconnect();
  });
