import { redirect } from "next/navigation";
import { TeacherPrimaryNav } from "@/components/teacher-primary-nav";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherContentLayout({
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
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
          <TeacherPrimaryNav />
          <span className="ml-auto text-muted">Signed in as {user.user_id}</span>
        </div>
        {children}
      </div>
    </main>
  );
}
