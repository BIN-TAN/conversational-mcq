import { PrismaClient } from "@prisma/client";
import { createAssessment, updateAssessment } from "../src/lib/services/content/assessments";
import { ContentServiceError } from "../src/lib/services/content/errors";
import { hashSecret } from "../src/lib/password";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import { cleanupResponseCollectionFixture, createResponseCollectionFixture } from "./response-collection-smoke-fixture";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup(prefix: string) {
  await cleanupResponseCollectionFixture(prisma, prefix);
  const assessments = await prisma.assessment.findMany({
    where: { title: { startsWith: prefix } },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);

  await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } });
  await prisma.user.deleteMany({ where: { user_id: { startsWith: prefix } } });
}

async function main() {
  const prefix = `phase7c_mode_smoke_${Date.now()}`;
  await cleanup(prefix);

  try {
    const teacher = await prisma.user.create({
      data: {
        user_id: `${prefix}_teacher_only`,
        user_id_normalized: normalizeUserId(`${prefix}_teacher_only`),
        role: "teacher_researcher",
        password_hash: await hashSecret(`${prefix}_teacher_password`)
      }
    });
    const created = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `${prefix} default assessment`,
        description: "Temporary mode smoke assessment.",
        workflow_mode: "manual_review"
      }
    });

    assert(
      created.response_collection_mode === "llm_assisted",
      "New assessments should default to LLM-assisted response collection."
    );

    const updated = await updateAssessment({
      teacher_user_db_id: teacher.id,
      assessment_public_id: created.assessment_public_id,
      data: {
        response_collection_mode: "deterministic"
      }
    });
    assert(
      updated.response_collection_mode === "deterministic",
      "Unused assessment response collection mode should be editable."
    );

    const fixture = await createResponseCollectionFixture({
      prisma,
      prefix,
      responseCollectionMode: "llm_assisted",
      sessionModeSnapshot: "llm_assisted"
    });

    await prisma.assessment.update({
      where: { id: fixture.assessment.id },
      data: { response_collection_mode: "deterministic" }
    });
    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { id: fixture.session.id },
      select: { response_collection_mode_snapshot: true }
    });
    assert(
      session.response_collection_mode_snapshot === "llm_assisted",
      "Existing session snapshot should not change when assessment mode changes."
    );

    let locked = false;
    try {
      await updateAssessment({
        teacher_user_db_id: fixture.teacher.id,
        assessment_public_id: fixture.assessment.assessment_public_id,
        data: {
          response_collection_mode: "llm_assisted"
        }
      });
    } catch (error) {
      locked =
        error instanceof ContentServiceError &&
        error.code === "content_locked_after_student_session";
    }
    assert(locked, "Changing response collection mode after a student session should be blocked.");

    console.log("Response collection mode smoke test passed.");
  } finally {
    await cleanup(prefix);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

