import { redirect } from "next/navigation";
import { NewStudentClient } from "@/components/teacher-students/new-student-client";
import { StudentAccountNav } from "@/components/teacher-students/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function NewTeacherStudentPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <StudentAccountNav userId={user.user_id} />
        <header className="border-b border-line pb-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            teacher_researcher student accounts
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Create student</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Create one student account and generate or set a one-time temporary password. Students
            do not self-register in this prototype.
          </p>
        </header>
        <section className="mt-6">
          <NewStudentClient />
        </section>
      </div>
    </main>
  );
}
