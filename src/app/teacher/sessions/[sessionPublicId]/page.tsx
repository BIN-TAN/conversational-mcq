import { redirect } from "next/navigation";
import { TeacherPageHeader } from "@/components/teacher-page-header";
import { TeacherSessionDetailClient } from "@/components/teacher-review/session-detail-client";
import { TeacherReviewNav } from "@/components/teacher-review/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherSessionDetailPage({
  params
}: {
  params: Promise<{ sessionPublicId: string }>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  const { sessionPublicId } = await params;

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <TeacherReviewNav userId={user.user_id} />
        <TeacherPageHeader title="Session detail" metadata={<span>Session ID: {sessionPublicId}</span>} />
        <section className="mt-6">
          <TeacherSessionDetailClient sessionPublicId={sessionPublicId} />
        </section>
      </div>
    </main>
  );
}
