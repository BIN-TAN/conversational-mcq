import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createAssessment } from "../src/lib/services/content/assessments";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  assert(url.pathname.startsWith("/conversational_mcq_classroom_audit_ux"));
  assert.equal(process.env.LLM_LIVE_CALLS_ENABLED, "false");
  try {
    const name = `review_ux_${randomUUID()}`;
    const teacher = await prisma.user.create({ data: { user_id: name, user_id_normalized: name, role: "teacher_researcher" } });
    const draft = await createAssessment({ teacher_user_db_id: teacher.id, data: { title: "Synthetic MCQ Review", auto_create_primary_topic: true } });
    console.log(JSON.stringify({ teacher: { id: teacher.id, user_id: teacher.user_id, role: teacher.role, auth_version: teacher.auth_version }, draftId: draft.assessment_public_id }));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("Synthetic review fixture failed."); process.exitCode = 1; });
