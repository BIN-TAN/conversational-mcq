import { prisma } from "@/lib/db";

export type TeacherHomeSummary = {
  published_mini_tests: number;
  draft_mini_tests: number;
  active_students: number;
};

/** Counts for the instructor home page. Archived mini tests and inactive accounts are left out. */
export async function getTeacherHomeSummary(teacherUserDbId: string): Promise<TeacherHomeSummary> {
  const [published, drafts, students] = await Promise.all([
    prisma.assessment.count({ where: { created_by_user_db_id: teacherUserDbId, status: "published" } }),
    prisma.assessment.count({ where: { created_by_user_db_id: teacherUserDbId, status: "draft" } }),
    prisma.user.count({
      where: { role: "student", account_status: "active", created_by_teacher_user_id: teacherUserDbId }
    })
  ]);
  return { published_mini_tests: published, draft_mini_tests: drafts, active_students: students };
}
