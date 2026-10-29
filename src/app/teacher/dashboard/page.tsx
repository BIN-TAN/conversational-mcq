import { redirect } from "next/navigation";
import { AssessmentDashboardClient } from "@/components/teacher-dashboard/assessment-dashboard-client";
import { getCurrentUser } from "@/lib/auth";
import { ContentServiceError } from "@/lib/services/content/errors";
import { getTeacherAssessmentDashboard } from "@/lib/services/teacher-dashboard/assessment-dashboard";

export default async function TeacherDashboardPage({
  searchParams
}: {
  searchParams: Promise<{ assessment?: string; view?: string }>;
}) {
  // Links from the home page open one mini test on one tab (for example its item review).
  const { assessment, view } = await searchParams;
  const user = await getCurrentUser();

  if (!user) {
    redirect("/teacher/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  // getTeacherAssessmentDashboard opens only the instructor's own mini tests that are not
  // archived; an unknown or foreign mini test in the link falls back to the default choice.
  const requested = typeof assessment === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(assessment) ? assessment : null;
  const dashboard = await getTeacherAssessmentDashboard({ teacher_user_db_id: user.user_db_id, assessment_public_id: requested })
    .catch((error: unknown) => {
      if (requested && error instanceof ContentServiceError && error.code === "not_found") {
        return getTeacherAssessmentDashboard({ teacher_user_db_id: user.user_db_id });
      }
      throw error;
    });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <AssessmentDashboardClient initialDashboard={dashboard} initialView={view === "items" ? "items" : "overview"} />
    </main>
  );
}
