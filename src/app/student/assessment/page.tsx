import { redirect } from "next/navigation";
import { AvailableAssessmentsClient } from "@/components/student-assessment/available-assessments-client";
import { getCurrentUser } from "@/lib/auth";

export default async function StudentAssessmentPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "student") {
    redirect("/teacher/dashboard");
  }

  if (user.must_change_password) {
    redirect("/student/account/password");
  }

  return <AvailableAssessmentsClient userId={user.user_id} />;
}
