import Link from "next/link";
import { Activity, Database, FileJson, FileWarning, History, ListChecks } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

const sections = [
  {
    title: "Sessions",
    description: "Student sessions, status, concept progress, and resume state placeholders.",
    icon: Activity
  },
  {
    title: "Agent Metadata",
    description: "Prompt versions, schema versions, model names, retries, and validation errors.",
    icon: History
  },
  {
    title: "Flags",
    description: "Needs-review sessions, prompt injection attempts, and long follow-up flags.",
    icon: FileWarning
  },
  {
    title: "Data Foundation",
    description: "Prisma/PostgreSQL setup begins with the minimal auth-related users table.",
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
          <h1 className="mt-2 text-3xl font-semibold text-ink">Dashboard shell</h1>
          <p className="mt-2 text-sm text-muted">Signed in as {user.user_id}</p>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
            This is a Phase 1 route shell. Full session review, transcript views, profile history,
            process logs, agent-call inspection, and exports are intentionally deferred.
          </p>
        </header>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
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
            href="/teacher/content/assessments"
          >
            <Database className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-ink">Assessment list</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Review assessment status, public IDs, concept units, and item-set readiness.
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
