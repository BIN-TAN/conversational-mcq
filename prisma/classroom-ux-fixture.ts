import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { ensureTeacherReviewDemoFixture } from "./demo-teacher-review-fixture";
import { createResponseCollectionFixture } from "./response-collection-smoke-fixture";
import { createAssessment } from "../src/lib/services/content/assessments";
import { getAssessmentItemDesign, saveAssessmentItemDesign } from "../src/lib/services/content/item-design";
import { prisma } from "../src/lib/db";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  assert(url.pathname.startsWith("/conversational_mcq_classroom_audit_ux"));
  assert.equal(process.env.LLM_LIVE_CALLS_ENABLED, "false");
  const db = new PrismaClient();
  try {
    const history = await ensureTeacherReviewDemoFixture(db);
    await db.user.update({ where: { id: history.student.id }, data: { created_by_teacher_user_id: history.teacher.id } });
    await db.assessment.update({ where: { id: history.assessment.id }, data: { title: "Week 1: Interpreting Evidence", folder_label: "Week 1" } });
    await db.assessmentSession.update({ where: { id: history.session.id }, data: { status: "completed", current_phase: "session_completed", completed_at: new Date() } });
    const active = await createResponseCollectionFixture({ prisma: db, prefix: `ux_smoke_${Date.now()}`, responseCollectionMode: "deterministic" });
    await db.user.update({ where: { id: active.student.id }, data: { created_by_teacher_user_id: history.teacher.id } });
    await db.assessment.update({ where: { id: active.assessment.id }, data: { title: "Reliability and Validity", created_by_user_db_id: history.teacher.id, folder_label: "Week 2", workflow_mode: "automatic" } });
    await db.assessmentSession.update({ where: { id: active.session.id }, data: { workflow_mode_snapshot: "automatic" } });
    const draft = await createAssessment({ teacher_user_db_id: history.teacher.id, data: { title: "Week 3: Measurement, Score Interpretation, Reliability, Validity, and Uncertainty Across Different Populations", folder_label: "Week 3", auto_create_primary_topic: true } });
    const input = { teacher_user_db_id: history.teacher.id, assessment_public_id: draft.assessment_public_id };
    const design = await getAssessmentItemDesign(input);
    await saveAssessmentItemDesign({ ...input, data: { expected_concept_unit_version: design.concept_unit_version, blueprint: {
      ...design.blueprint,
      section_topic: "Reliability, Validity, and Score Uncertainty",
      section_summary: "Interpret measurement evidence for a stated purpose and population.",
      objectives: [
        { objective_id: "obj_reliability", statement: "Distinguish consistency from validity evidence.", evidence_requirements: ["Explain why reliability alone cannot establish validity.", "Identify evidence for the proposed use of scores."] },
        { objective_id: "obj_sem", statement: "Explain uncertainty around an observed score.", evidence_requirements: ["Interpret SEM without claiming an exact true score."] },
        { objective_id: "obj_context", statement: "Evaluate interpretations in a new context.", evidence_requirements: ["Identify limits of transfer across populations."] }
      ],
      misconception_hypotheses: [{ misconception_id: "mis_reliability", statement: "Reliability automatically establishes validity.", linked_objective_ids: ["obj_reliability"], student_language_examples: ["The test is consistent, so it must measure the right thing."], why_plausible: "Consistency and accuracy are easily confused." }],
      exemplar_items: [{ exemplar_id: "example_1", item_text: "A school reuses a reliable selection test for individual learning needs. What evidence is missing?", observed_difficulty_note: "Students confuse reliability and validity." }],
      generation_settings: { ...design.blueprint.generation_settings, target_item_count: 9 }
    } } });
    const identity = (user: typeof history.teacher) => ({ id: user.id, user_id: user.user_id, role: user.role, auth_version: user.auth_version });
    console.log(JSON.stringify({ teacher: identity(history.teacher), student: identity(active.student), historyStudent: identity(history.student), activeSession: active.session.session_public_id, historySession: history.session.session_public_id, draftId: draft.assessment_public_id }));
  } finally {
    await db.$disconnect();
    await prisma.$disconnect();
  }
}

main().catch(() => { console.error("Synthetic UX fixture preparation failed."); process.exitCode = 1; });
