import { redirect } from "next/navigation";
import { TeacherPageHeader } from "@/components/teacher-page-header";
import { SimpleCsvExplorerClient } from "@/components/teacher-data/simple-csv-explorer-client";
import { DataNav } from "@/components/teacher-data/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherDataExplorerPage() {
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
        <TeacherPageHeader title="Data Explorer" />

        <div className="mt-6">
          <SimpleCsvExplorerClient />
        </div>
      </div>
    </main>
  );
}
