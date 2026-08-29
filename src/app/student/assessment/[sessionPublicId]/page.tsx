import { redirect } from "next/navigation";
import { AssessmentSessionClient } from "@/components/student-assessment/assessment-session-client";
import { getCurrentUser } from "@/lib/auth";

export default async function StudentAssessmentSessionPage({
  params,
  searchParams
}: {
  params: Promise<{ sessionPublicId: string }>;
  searchParams: Promise<{ review?: string }>;
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
  const { review } = await searchParams;

  return (
    <AssessmentSessionClient
      readOnlyReview={review === "1"}
      sessionPublicId={sessionPublicId}
    />
  );
}
