import Link from "next/link";
import { BookOpenCheck, LayoutDashboard, MessageSquareText } from "lucide-react";

const links = [
  {
    href: "/student/login",
    label: "Student Login",
    description: "Enter with a classroom ID and roster-issued credential.",
    icon: BookOpenCheck
  },
  {
    href: "/student/assessment",
    label: "Assessment Shell",
    description: "Placeholder for the ChatGPT-style student assessment interface.",
    icon: MessageSquareText
  },
  {
    href: "/teacher/dashboard",
    label: "Teacher Dashboard",
    description: "Placeholder for teacher_researcher monitoring and review.",
    icon: LayoutDashboard
  }
];

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            Conversational MCQ prototype
          </p>
          <h1 className="mt-3 text-4xl font-semibold text-ink">Phase 1 project shell</h1>
          <p className="mt-4 text-base leading-7 text-muted">
            This scaffold sets up routing, styling, minimal auth infrastructure, and Prisma
            connection foundations. Assessment flow, agents, logging tables, and exports are
            intentionally left for later phases.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {links.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:-translate-y-0.5 hover:border-accent"
                href={item.href}
                key={item.href}
              >
                <Icon className="h-6 w-6 text-accent" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold text-ink">{item.label}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">{item.description}</p>
              </Link>
            );
          })}
        </section>
      </div>
    </main>
  );
}
