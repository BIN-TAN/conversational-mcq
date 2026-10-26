import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { teacherHomeSections, teacherHomeSteps } from "@/components/teacher-home-sections";
import { getCurrentUser } from "@/lib/auth";
import { getTeacherHomeSummary } from "@/lib/services/teacher-home/summary";

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The instructor home page: what each part of the workspace is for, shown after sign-in. */
export default async function TeacherHomePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/teacher/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  const summary = await getTeacherHomeSummary(user.user_db_id);

  return (
    <main className="px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
          <h2 className="text-xl font-semibold text-ink">Welcome</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            This page shows what each part of the workspace is for. Use the buttons along the top to move between them at any time.
          </p>
          <p className="mt-3 text-sm text-ink">
            You have {plural(summary.published_mini_tests, "published mini test", "published mini tests")},{" "}
            {plural(summary.draft_mini_tests, "draft", "drafts")} and{" "}
            {plural(summary.active_students, "active student account", "active student accounts")}.
          </p>
        </section>

        <section aria-labelledby="teacher-home-sections" className="space-y-3">
          <h2 className="text-lg font-semibold text-ink" id="teacher-home-sections">Parts of the workspace</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {teacherHomeSections.map((section) => (
              <Link
                className="group flex flex-col rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                href={section.href}
                key={section.href}
              >
                <h3 className="text-base font-semibold text-ink">{section.label}</h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-muted">{section.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent">
                  Open {section.label}
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="teacher-home-steps" className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-ink" id="teacher-home-steps">The usual order of work</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-ink">
            {teacherHomeSteps.map((step) => (
              <li key={step.href}>
                <Link className="underline-offset-2 hover:underline" href={step.href}>{step.text}</Link>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
