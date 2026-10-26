import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, Cpu, LayoutDashboard, MessagesSquare, Table2, Users, type LucideIcon } from "lucide-react";
import { teacherHomeSections } from "@/components/teacher-home-sections";
import { getCurrentUser } from "@/lib/auth";

const sectionIcons: Record<string, LucideIcon> = {
  "/teacher/dashboard": LayoutDashboard,
  "/teacher/content": ClipboardList,
  "/teacher/students": Users,
  "/teacher/sessions": MessagesSquare,
  "/teacher/data": Table2,
  "/teacher/system/llm": Cpu
};

/** The instructor home page shown after sign-in: one card for each part of the workspace. */
export default async function TeacherHomePage() {
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
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teacherHomeSections.map((section) => {
            const Icon = sectionIcons[section.href] ?? LayoutDashboard;
            return (
              <Link
                className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                href={section.href}
                key={section.href}
              >
                <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold text-ink">{section.label}</h2>
              </Link>
            );
          })}
        </section>
      </div>
    </main>
  );
}
