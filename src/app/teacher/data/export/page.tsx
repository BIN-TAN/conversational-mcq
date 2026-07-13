import { redirect } from "next/navigation";
import { TeacherPageHeader } from "@/components/teacher-page-header";
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
        <TeacherPageHeader title="Master CSV export" />
        <section className="mt-6">
          <MasterExportClient />
        </section>
      </div>
    </main>
  );
}
