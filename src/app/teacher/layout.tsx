import { redirect } from "next/navigation";
import { TeacherWorkspaceHeader } from "@/components/teacher-workspace-header";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  return (
    <div className="min-h-screen bg-panel-gray">
      <TeacherWorkspaceHeader userId={user.user_id} />
      {children}
    </div>
  );
}
