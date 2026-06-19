import { redirect } from "next/navigation";
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
        <header className="border-b border-line pb-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            teacher_researcher session review
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Session detail</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Public route ID: {sessionPublicId}. Internal database UUIDs are not shown in normal
            review views.
          </p>
        </header>
        <section className="mt-6">
          <TeacherSessionDetailClient sessionPublicId={sessionPublicId} />
        </section>
      </div>
    </main>
  );
}
