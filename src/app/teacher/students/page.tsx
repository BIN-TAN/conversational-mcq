import { redirect } from "next/navigation";
import { StudentListClient } from "@/components/teacher-students/student-list-client";
import { StudentAccountNav } from "@/components/teacher-students/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherStudentsPage() {
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
        <StudentAccountNav userId={user.user_id} />
        <header className="border-b border-line pb-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            teacher_researcher student accounts
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Student accounts</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Search and manage pilot student accounts. This area never displays current plaintext
            passwords, access codes, or credential hashes.
          </p>
        </header>
        <section className="mt-6">
          <StudentListClient />
        </section>
      </div>
    </main>
  );
}
