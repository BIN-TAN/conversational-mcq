import { redirect } from "next/navigation";
import { StudentDetailClient } from "@/components/teacher-students/student-detail-client";
import { StudentAccountNav } from "@/components/teacher-students/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherStudentDetailPage({
  params
}: {
  params: Promise<{ userId: string }>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  const { userId } = await params;
  const decodedUserId = decodeURIComponent(userId);

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <StudentAccountNav userId={user.user_id} />
        <header className="border-b border-line pb-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            teacher_researcher student accounts
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Student detail</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Canonical classroom/research user_id: {decodedUserId}. The user_id is immutable through
            normal account-management routes.
          </p>
        </header>
        <section className="mt-6">
          <StudentDetailClient userId={decodedUserId} />
        </section>
      </div>
    </main>
  );
}
