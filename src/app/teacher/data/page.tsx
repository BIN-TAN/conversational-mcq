import Link from "next/link";
import { FileUp, Table2 } from "lucide-react";
import { redirect } from "next/navigation";
import { TeacherPageHeader } from "@/components/teacher-page-header";
import { DataNav } from "@/components/teacher-data/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherDataPage() {
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
        <TeacherPageHeader title="Data and outcomes" />

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <Link
            className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
            href="/teacher/data/research"
          >
            <Table2 className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">Research data and exports</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Download quick summaries, analysis-ready CSV tables, full archive files, and the
              variable dictionary from one place.
            </p>
          </Link>

          <Link
            className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
            href="/teacher/data/summative-outcomes"
          >
            <FileUp className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">Summative outcomes</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Upload or paste outcome CSV data, preview validation results, commit valid batches,
              and inspect import history.
            </p>
          </Link>

        </section>
      </div>
    </main>
  );
}
