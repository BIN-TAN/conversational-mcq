import { redirect } from "next/navigation";
import { SimpleCsvExplorerClient } from "@/components/teacher-data/simple-csv-explorer-client";
import { DataNav } from "@/components/teacher-data/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherDataExplorerPage() {
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
        <DataNav userId={user.user_id} />
        <header className="border-b border-line pb-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            teacher/research CSV explorer
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Simple CSV downloads</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Download assessment, student, or student-by-assessment summary CSV files without
            raw responses, answer keys, process payloads, provider output, or diagnostic notes.
          </p>
        </header>

        <div className="mt-6">
          <SimpleCsvExplorerClient />
        </div>
      </div>
    </main>
  );
}
