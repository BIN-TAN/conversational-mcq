import { redirect } from "next/navigation";
import { StudentListClient } from "@/components/teacher-students/student-list-client";
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
    <main className="px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <section>
          <StudentListClient />
        </section>
      </div>
    </main>
  );
}
