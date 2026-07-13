import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

const links = [
  { href: "/teacher/dashboard", label: "Dashboard" },
  { href: "/teacher/content", label: "Assessment management" },
  { href: "/teacher/students", label: "Student accounts" },
  { href: "/teacher/content/assessments", label: "Mini tests" }
];

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
        <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm">
          {links.map((link) => (
            <Link
              className="rounded-md border border-line bg-white px-3 py-2 font-medium text-ink transition hover:border-accent"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
          <span className="ml-auto text-muted">Signed in as {user.user_id}</span>
        </nav>
        {children}
      </div>
    </main>
  );
}
