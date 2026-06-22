import { redirect } from "next/navigation";
import { EvalDashboardClient } from "@/components/teacher-evals/evals-dashboard-client";
import { TeacherEvalNav } from "@/components/teacher-evals/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherEvalsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <TeacherEvalNav userId={user.user_id} />
        <header className="mb-6 border-b border-line pb-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            model evaluation
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Agent evaluation harness</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Review synthetic evaluation suites, run mock evaluations, inspect validation outcomes,
            annotate outputs, and export development-evaluation results. No live OpenAI calls are
            made in Phase 7E1.
          </p>
        </header>
        <EvalDashboardClient />
      </div>
    </main>
  );
}
