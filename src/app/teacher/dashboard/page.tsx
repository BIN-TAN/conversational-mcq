import Link from "next/link";
import { BrainCircuit, FileJson, ListChecks, Microscope, Table2, UserRoundCog, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { TeacherLogoutButton } from "@/components/teacher-logout-button";
import { UAlbertaLogo } from "@/components/ualberta-logo";
import { getCurrentUser } from "@/lib/auth";

const teacherNavLinks = [
  { href: "/teacher/dashboard", label: "Dashboard" },
  { href: "/teacher/students", label: "Student accounts" },
  { href: "/teacher/sessions", label: "Student sessions" },
  { href: "/teacher/data", label: "Data and outcomes" },
  { href: "/teacher/system/llm", label: "LLM status" },
  { href: "/teacher/content/import-json", label: "JSON import" }
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
    <main className="min-h-screen bg-panel-gray">
      <header className="border-b-4 border-ualberta-gold bg-ualberta-green-dark text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <UAlbertaLogo compact priority />
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-ualberta-gold">
                  EDPY 507: Measurement Theory
                </p>
                <h1 className="mt-2 text-3xl font-semibold text-white">Dashboard</h1>
                <p className="mt-2 text-sm text-white/80">Signed in as {user.user_id}</p>
              </div>
            </div>
            <TeacherLogoutButton />
          </div>
          <nav className="flex flex-wrap gap-2 text-sm font-semibold" aria-label="Teacher tools">
            {teacherNavLinks.map((link) => (
              <Link
                className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-white/90 transition hover:border-ualberta-gold hover:bg-white/10 hover:text-white"
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <section className="rounded-lg border border-border-light bg-white p-5">
          <p className="max-w-3xl text-sm leading-6 text-muted">
            Manage student accounts, build mini tests, review student sessions, and export
            teacher/research data.
          </p>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <Link
            className="rounded-lg border border-border-light bg-white p-5 shadow-soft transition hover:border-ualberta-green"
            href="/teacher/students"
          >
            <UserRoundCog className="h-5 w-5 text-ualberta-green" aria-hidden="true" />
            <div className="mt-4 h-1 w-10 rounded-full bg-ualberta-gold" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-ualberta-green-dark">Student accounts</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Import rosters, create accounts, reset access codes, and manage active or inactive
              status.
            </p>
          </Link>
          <Link
            className="rounded-lg border border-border-light bg-white p-5 shadow-soft transition hover:border-ualberta-green"
            href="/teacher/sessions"
          >
            <Users className="h-5 w-5 text-ualberta-green" aria-hidden="true" />
            <div className="mt-4 h-1 w-10 rounded-full bg-ualberta-gold" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-ualberta-green-dark">Student sessions</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Review assessment sessions, transcripts, process context, item responses, and response
              packages.
            </p>
          </Link>
          <Link
            className="rounded-lg border border-border-light bg-white p-5 shadow-soft transition hover:border-ualberta-green"
            href="/teacher/content/assessments"
          >
            <ListChecks className="h-5 w-5 text-ualberta-green" aria-hidden="true" />
            <div className="mt-4 h-1 w-10 rounded-full bg-ualberta-gold" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-ualberta-green-dark">Assessments / Mini tests</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Build mini tests, add MCQ items, review diagnostic notes, and publish.
            </p>
          </Link>
          <Link
            className="rounded-lg border border-border-light bg-white p-5 shadow-soft transition hover:border-ualberta-green"
            href="/teacher/data/explorer"
          >
            <Table2 className="h-5 w-5 text-ualberta-green" aria-hidden="true" />
            <div className="mt-4 h-1 w-10 rounded-full bg-ualberta-gold" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-ualberta-green-dark">Data Explorer / exports</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Download lightweight CSVs and open the broader data/export tools.
            </p>
          </Link>
          <Link
            className="rounded-lg border border-border-light bg-white p-5 shadow-soft transition hover:border-ualberta-green"
            href="/teacher/content/import-json"
          >
            <FileJson className="h-5 w-5 text-ualberta-green" aria-hidden="true" />
            <div className="mt-4 h-1 w-10 rounded-full bg-ualberta-gold" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-ualberta-green-dark">JSON import</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Import prepared item-set JSON when the guided builder is not the right fit.
            </p>
          </Link>
          <Link
            className="rounded-lg border border-border-light bg-white p-5 shadow-soft transition hover:border-ualberta-green"
            href="/teacher/system/llm"
          >
            <BrainCircuit className="h-5 w-5 text-ualberta-green" aria-hidden="true" />
            <div className="mt-4 h-1 w-10 rounded-full bg-ualberta-gold" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-ualberta-green-dark">LLM status</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Review provider readiness, draft prompt versions, schema versions, and mock-mode safety.
            </p>
          </Link>
          <Link
            className="rounded-lg border border-border-light bg-white p-5 shadow-soft transition hover:border-ualberta-green"
            href="/teacher/evals"
          >
            <Microscope className="h-5 w-5 text-ualberta-green" aria-hidden="true" />
            <div className="mt-4 h-1 w-10 rounded-full bg-ualberta-gold" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-ualberta-green-dark">Model evaluation</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Load synthetic cases, run mock agent evaluations, annotate outputs, and export
              development-evaluation results before live model testing.
            </p>
          </Link>
        </section>
      </div>
    </main>
  );
}
