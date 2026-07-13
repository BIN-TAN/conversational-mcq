import { redirect } from "next/navigation";
import { TeacherAccountUtilityLink } from "@/components/teacher-account-utility-link";
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
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <TeacherAccountUtilityLink />
            <span className="text-muted">Signed in as {user.user_id}</span>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
