import Link from "next/link";
import { Activity, BrainCircuit, Database, FileJson, FileWarning, History, ListChecks, Table2, UserRoundCog, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

const sections = [
  {
    title: "Sessions",
    description: "Read-only review of student sessions, concept progress, transcripts, process context, and response packages.",
    icon: Activity
  },
  {
    title: "Agent Metadata",
    description: "Review prompt versions, schema versions, model names, retries, validation errors, and automatic workflow audit records when agent calls exist.",
    icon: History
  },
  {
    title: "Flags",
    description: "Needs-review sessions and neutral process-event counts are review context, not misconduct labels.",
    icon: FileWarning
  },
  {
    title: "Data Foundation",
    description: "Normalized Prisma/PostgreSQL records use internal UUIDs for relations and public IDs for routes.",
    icon: Database
  }
];

export default async function TeacherDashboardPage() {
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
        <header className="border-b border-line pb-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            teacher_researcher
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Dashboard</h1>
          <p className="mt-2 text-sm text-muted">Signed in as {user.user_id}</p>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
            Use this teacher_researcher area to manage content, review existing student sessions,
            prepare supervised outcome imports and master CSV exports, and monitor automatic
            profiling, planning, and follow-up startup when server-side LLM execution is enabled.
          </p>
        </header>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <Link
            className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
            href="/teacher/students"
          >
            <UserRoundCog className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">Student accounts</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Import rosters, create accounts, reset access codes, and manage active or inactive
              status.
            </p>
          </Link>
          <Link
            className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
            href="/teacher/sessions"
          >
            <Users className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">Student sessions</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Review assessment sessions, transcripts, process context, item responses, and response
              packages.
            </p>
          </Link>
          <Link
            className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
            href="/teacher/content"
          >
            <ListChecks className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">Content management</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Manage assessments, concept units, MCQ items, publish validation, and archive actions.
            </p>
          </Link>
          <Link
            className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
            href="/teacher/content/import-json"
          >
            <FileJson className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">JSON import</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Import manually prepared concept-based item sets through the Phase 3A API.
            </p>
          </Link>
          <Link
            className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
            href="/teacher/data"
          >
            <Table2 className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">Data and outcomes</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Import supervised summative outcomes and generate the merged master assessment CSV.
            </p>
          </Link>
          <Link
            className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
            href="/teacher/content/assessments"
          >
            <Database className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">Assessment list</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Review assessment status, public IDs, concept units, and item-set readiness.
            </p>
          </Link>
          <Link
            className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
            href="/teacher/system/llm"
          >
            <BrainCircuit className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">LLM status</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Review provider readiness, draft prompt versions, schema versions, and mock-mode safety.
            </p>
          </Link>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          {sections.map((section) => {
            const Icon = section.icon;

            return (
              <article className="rounded-lg border border-line bg-white p-5 shadow-soft" key={section.title}>
                <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold text-ink">{section.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">{section.description}</p>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
