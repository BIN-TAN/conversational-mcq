import { redirect } from "next/navigation";
import { TeacherPageHeader } from "@/components/teacher-page-header";
import { ResearchDataExportsClient } from "@/components/teacher-data/research-data-exports-client";
import { DataNav } from "@/components/teacher-data/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherResearchDataExportsPage({
  searchParams
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  const resolvedSearchParams = await searchParams;
  const tab = resolvedSearchParams?.tab;
  const initialTab =
    tab === "analysis" || tab === "archive" || tab === "dictionary" || tab === "quick"
      ? tab
      : "quick";

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <DataNav userId={user.user_id} />
        <TeacherPageHeader title="Research data and exports" />
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
          Download assessment data at the right row grain: quick summaries, normalized analysis
          tables, full archive files, or the variable dictionary.
        </p>
        <section className="mt-6">
          <ResearchDataExportsClient initialTab={initialTab} />
        </section>
      </div>
    </main>
  );
}

