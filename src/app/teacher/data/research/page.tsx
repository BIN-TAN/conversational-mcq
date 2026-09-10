import { redirect } from "next/navigation";
import { TeacherPageHeader } from "@/components/teacher-page-header";
import { ResearchDataExportsClient } from "@/components/teacher-data/research-data-exports-client";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherResearchDataExportsPage({
  searchParams
}: {
  searchParams?: Promise<{ section?: string; tab?: string }>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  const resolvedSearchParams = await searchParams;
  const section = resolvedSearchParams?.section ?? resolvedSearchParams?.tab;
  const initialSection = section === "dictionary" ? "dictionary" : "dataset";

  return (
    <main className="px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <TeacherPageHeader title="Research data and exports" />
        <section className="mt-6">
          <ResearchDataExportsClient initialSection={initialSection} />
        </section>
      </div>
    </main>
  );
}
