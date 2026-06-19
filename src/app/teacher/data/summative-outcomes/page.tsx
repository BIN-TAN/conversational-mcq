import { redirect } from "next/navigation";
import { SummativeOutcomesClient } from "@/components/teacher-data/summative-outcomes-client";
import { DataNav } from "@/components/teacher-data/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherSummativeOutcomesPage() {
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
        <DataNav userId={user.user_id} />
        <header className="border-b border-line pb-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            supervised outcome import
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Summative outcomes</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Preview and commit supervised summative outcome CSV data. This page stores audited
            outcome records only; it does not generate formative or diagnostic profiles.
          </p>
        </header>
        <section className="mt-6">
          <SummativeOutcomesClient />
        </section>
      </div>
    </main>
  );
}
