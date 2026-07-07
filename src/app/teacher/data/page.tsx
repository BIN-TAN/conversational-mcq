import Link from "next/link";
import { Archive, FileUp, Table2 } from "lucide-react";
import { redirect } from "next/navigation";
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
        <header className="border-b border-line pb-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            teacher_researcher data management
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Data and outcomes</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Import supervised summative outcome records and generate one merged master assessment
            CSV for research analysis. Persisted profile, planning, follow-up, progression,
            workflow, and agent-audit records are included without changing classroom records.
          </p>
        </header>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
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

          <Link
            className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
            href="/teacher/data/export"
          >
            <Table2 className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">Master CSV export</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Generate master_assessment_export.csv with public IDs, placeholder rows for incomplete
              sessions, process counts, transcripts, response packages, activated agent outputs,
              workflow records, and active summative outcomes.
            </p>
          </Link>

          <a
            className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
            href="/api/teacher/research-export"
          >
            <Archive className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">Download all research data</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Generate a teacher/research ZIP with readable transcripts, redacted structured
              records, data dictionary, manifest, process summaries, and evidence summaries.
              Restricted item keys are excluded by default.
            </p>
          </a>
        </section>
      </div>
    </main>
  );
}
