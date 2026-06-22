import { redirect } from "next/navigation";
import { RosterImportClient } from "@/components/teacher-students/roster-import-client";
import { StudentAccountNav } from "@/components/teacher-students/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherRosterImportPage() {
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
            teacher_researcher roster import
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Roster import</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Upload or paste a roster CSV, preview validation results, then commit valid rows.
            Access codes are generated only during commit and shown once.
          </p>
        </header>
        <section className="mt-6">
          <RosterImportClient />
        </section>
      </div>
    </main>
  );
}
