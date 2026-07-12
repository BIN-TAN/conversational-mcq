import Link from "next/link";
import { redirect } from "next/navigation";
import { AssessmentDashboardClient } from "@/components/teacher-dashboard/assessment-dashboard-client";
import { TeacherLogoutButton } from "@/components/teacher-logout-button";
import { UAlbertaLogo } from "@/components/ualberta-logo";
import { getCurrentUser } from "@/lib/auth";
import { getTeacherAssessmentDashboard } from "@/lib/services/teacher-dashboard/assessment-dashboard";

const teacherNavLinks = [
  { href: "/teacher/dashboard", label: "Dashboard" },
  { href: "/teacher/students", label: "Student accounts" },
  { href: "/teacher/sessions", label: "Student sessions" },
  { href: "/teacher/data", label: "Data and outcomes" },
  { href: "/teacher/system/llm", label: "LLM status" }
];

export default async function TeacherDashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  const dashboard = await getTeacherAssessmentDashboard({
    teacher_user_db_id: user.user_db_id
  });

  return (
    <main className="min-h-screen bg-panel-gray">
      <header className="border-b-4 border-ualberta-gold bg-ualberta-green-dark text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <UAlbertaLogo compact priority />
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-ualberta-gold">
                  EDPY 507: Measurement Theory
                </p>
                <h1 className="mt-2 text-3xl font-semibold text-white">Assessment dashboard</h1>
                <p className="mt-2 text-sm text-white/80">Signed in as {user.user_id}</p>
              </div>
            </div>
            <TeacherLogoutButton />
          </div>
          <nav className="flex flex-wrap gap-2 text-sm font-semibold" aria-label="Teacher tools">
            {teacherNavLinks.map((link) => (
              <Link
                className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-white/90 transition hover:border-ualberta-gold hover:bg-white/10 hover:text-white"
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <AssessmentDashboardClient initialDashboard={dashboard} />
      </div>
    </main>
  );
}
