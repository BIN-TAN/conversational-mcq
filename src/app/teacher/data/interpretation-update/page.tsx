import { redirect } from "next/navigation";
import { TeacherPageHeader } from "@/components/teacher-page-header";
import { InterpretationRelabelClient } from "@/components/teacher-data/interpretation-relabel-client";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherInterpretationUpdatePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/teacher/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  return (
    <main className="px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <TeacherPageHeader title="Update earlier interpretations" />
        <section className="mt-6">
          <InterpretationRelabelClient />
        </section>
      </div>
    </main>
  );
}
