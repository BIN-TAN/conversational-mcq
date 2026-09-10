import { redirect } from "next/navigation";
import { AssessmentDashboardClient } from "@/components/teacher-dashboard/assessment-dashboard-client";
import { getCurrentUser } from "@/lib/auth";
import { getTeacherAssessmentDashboard } from "@/lib/services/teacher-dashboard/assessment-dashboard";

export default async function TeacherDashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  const dashboard = await getTeacherAssessmentDashboard({
    teacher_user_db_id: user.user_db_id
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <AssessmentDashboardClient initialDashboard={dashboard} />
    </main>
  );
}
