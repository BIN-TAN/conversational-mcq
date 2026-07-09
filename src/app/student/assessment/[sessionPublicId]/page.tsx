import { redirect } from "next/navigation";
import { AssessmentSessionClient } from "@/components/student-assessment/assessment-session-client";
import { getCurrentUser } from "@/lib/auth";

export default async function StudentAssessmentSessionPage({
  params
}: {
  params: Promise<{ sessionPublicId: string }>;
}) {
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

  const { sessionPublicId } = await params;

  return <AssessmentSessionClient sessionPublicId={sessionPublicId} />;
}
