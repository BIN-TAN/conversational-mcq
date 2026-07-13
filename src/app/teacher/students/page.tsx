import { redirect } from "next/navigation";
import { TeacherPageHeader } from "@/components/teacher-page-header";
import { StudentListClient } from "@/components/teacher-students/student-list-client";
import { StudentAccountNav } from "@/components/teacher-students/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherStudentsPage() {
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
        <TeacherPageHeader title="Student accounts" />
        <section className="mt-6">
          <StudentListClient />
        </section>
      </div>
    </main>
  );
}
