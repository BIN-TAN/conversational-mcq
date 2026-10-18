import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function TeacherContentLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/teacher/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  return (
    <main className="px-6 py-8">
      <div className="mx-auto max-w-6xl">
        {children}
      </div>
    </main>
  );
}
