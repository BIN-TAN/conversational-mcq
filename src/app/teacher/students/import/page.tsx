import { redirect } from "next/navigation";
import { TeacherPageHeader } from "@/components/teacher-page-header";
import { RosterImportClient } from "@/components/teacher-students/roster-import-client";
import { StudentAccountNav } from "@/components/teacher-students/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherRosterImportPage() {
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
        <StudentAccountNav userId={user.user_id} />
        <TeacherPageHeader title="Import roster" />
        <section className="mt-6">
          <RosterImportClient />
        </section>
      </div>
    </main>
  );
}
