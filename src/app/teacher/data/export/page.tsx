import { redirect } from "next/navigation";
import { MasterExportClient } from "@/components/teacher-data/master-export-client";
import { DataNav } from "@/components/teacher-data/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherMasterExportPage() {
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
            master assessment CSV
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Master CSV export</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Generate master_assessment_export.csv as a derived research file from normalized
            database records. Public IDs are used in normal output, and missing evidence remains
            distinct from incorrect evidence.
          </p>
        </header>
        <section className="mt-6">
          <MasterExportClient />
        </section>
      </div>
    </main>
  );
}
