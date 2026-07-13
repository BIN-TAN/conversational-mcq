import { redirect } from "next/navigation";
import { TeacherPageHeader } from "@/components/teacher-page-header";
import { TeacherSessionListClient } from "@/components/teacher-review/session-list-client";
import { TeacherReviewNav } from "@/components/teacher-review/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherSessionsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <TeacherReviewNav userId={user.user_id} />
        <TeacherPageHeader title="Student sessions" />
        <section className="mt-6">
          <TeacherSessionListClient />
        </section>
      </div>
    </main>
  );
}
