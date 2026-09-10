import { redirect } from "next/navigation";
import { EvalRunItemClient } from "@/components/teacher-evals/run-item-client";
import { TeacherEvalNav } from "@/components/teacher-evals/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function EvalRunItemPage(
  context: { params: Promise<{ runItemPublicId: string }> }
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
        <EvalRunItemClient runItemPublicId={params.runItemPublicId} />
      </div>
    </main>
  );
}
