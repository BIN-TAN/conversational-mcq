import { redirect } from "next/navigation";
import { AvailableAssessmentsClient } from "@/components/student-assessment/available-assessments-client";
import { getCurrentUser } from "@/lib/auth";
import { researchStudyCode } from "@/lib/services/teacher-research-data/pseudonymization";

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

  // The study code links the consent form and the course-end questionnaire to system records
  // without names (Appendix G). Without a configured pseudonymization key it is not shown.
  let studyCode: string | null = null;
  try {
    studyCode = researchStudyCode(user.user_id);
  } catch {
    studyCode = null;
  }

  return <AvailableAssessmentsClient userId={user.user_id} studyCode={studyCode} />;
}
