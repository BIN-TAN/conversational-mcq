import { redirect } from "next/navigation";
import { EvalRunDetailClient } from "@/components/teacher-evals/run-detail-client";
import { TeacherEvalNav } from "@/components/teacher-evals/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function EvalRunDetailPage(
  context: { params: Promise<{ runPublicId: string }> }
) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  const params = await context.params;

  return (
    <main className="px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <TeacherEvalNav />
        <EvalRunDetailClient runPublicId={params.runPublicId} />
      </div>
    </main>
  );
}
