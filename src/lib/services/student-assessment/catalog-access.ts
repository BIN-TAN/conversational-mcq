import type { Prisma } from "@prisma/client";

export const LEGACY_IRT_DEMO_ASSESSMENT_ID = "assessment_mvp_irt_theta_invariance";

export function canStartAssessmentFromCatalog(input: {
  student_teacher_db_id: string | null;
  assessment_creator_db_id: string;
  assessment_public_id: string;
}) {
  if (input.student_teacher_db_id) {
    return input.student_teacher_db_id === input.assessment_creator_db_id;
  }

  // Older unassigned accounts retain the single-course catalog, not the seeded demo.
  return input.assessment_public_id !== LEGACY_IRT_DEMO_ASSESSMENT_ID;
}

export function studentAssessmentCatalogWhere(input: {
  student_user_db_id: string;
  student_teacher_db_id: string | null;
}): Prisma.AssessmentWhereInput {
  return {
    status: { in: ["published", "archived"] },
    OR: [
      input.student_teacher_db_id
        ? { created_by_user_db_id: input.student_teacher_db_id }
        : { assessment_public_id: { not: LEGACY_IRT_DEMO_ASSESSMENT_ID } },
      // Catalog membership never removes a student's existing attempt history.
      { assessment_sessions: { some: { user_db_id: input.student_user_db_id } } }
    ]
  };
}
