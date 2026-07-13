import { redirect } from "next/navigation";
import { TeacherPageHeader } from "@/components/teacher-page-header";
import { StudentDetailClient } from "@/components/teacher-students/student-detail-client";
import { StudentAccountNav } from "@/components/teacher-students/ui";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherStudentDetailPage({
  params
}: {
  params: Promise<{ userId: string }>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  const { userId } = await params;
  const decodedUserId = decodeURIComponent(userId);

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <StudentAccountNav userId={user.user_id} />
        <TeacherPageHeader title="Student detail" metadata={<span>User ID: {decodedUserId}</span>} />
        <section className="mt-6">
          <StudentDetailClient userId={decodedUserId} />
        </section>
      </div>
    </main>
  );
}
